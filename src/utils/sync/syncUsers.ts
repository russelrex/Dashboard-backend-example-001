// src/utils/sync/syncUsers.ts
import axios from 'axios';
import { Db, ObjectId } from 'mongodb';
import { getAuthHeader } from '../ghlAuth';
import bcrypt from 'bcryptjs';
import { generateSecureToken } from '../security/tokenGenerator';
import { sendWelcomeEmail } from '../email/welcomeEmail';
import { publishAblyEvent } from '../ably/publishEvent';

/**
* Generate a temporary password for new users
*/
function generateTempPassword(): string {
 return Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
}

/**
* Map GHL role to our system role
*/
function mapGHLRole(ghlRole: string): string {
 const roleMap: Record<string, string> = {
   'admin': 'admin',
   'user': 'user',
   'agency': 'admin',
   'account': 'user'
 };
 
 return roleMap[ghlRole?.toLowerCase()] || 'user';
}

/**
* Map GHL permissions to our system
*/
function mapGHLPermissions(ghlPermissions: string[]): string[] {
 if (!ghlPermissions || !Array.isArray(ghlPermissions)) {
   return ['read'];
 }
 
 // Map GHL permissions to our simplified set
 const permissions = new Set<string>();
 
 ghlPermissions.forEach(perm => {
   if (perm.includes('write') || perm.includes('create') || perm.includes('update') || perm.includes('delete')) {
     permissions.add('write');
   }
   permissions.add('read');
 });
 
 return Array.from(permissions);
}

/**
* Get default user preferences with conditional SMS/phone provider
*/
function getDefaultPreferences(location: any) {
  // Determine if location has GHL/Twilio SMS capabilities
  const hasGHLSms = location.smsPhoneNumbers && location.smsPhoneNumbers.length > 0;
  const defaultSmsPhoneNumber = hasGHLSms ? location.smsPhoneNumbers.find(p => p.isDefault) || location.smsPhoneNumbers[0] : null;

  return {
    notifications: true,
    defaultCalendarView: 'week',
    emailSignature: '',
    theme: 'system',
    timezone: 'America/Denver',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
    firstDayOfWeek: 0,
    language: 'en',
    
    // Working Hours
    workingHours: {
      enabled: true,
      start: '09:00',
      end: '17:00',
      days: [1, 2, 3, 4, 5]
    },
    
    // Appointment Settings
    appointmentReminders: {
      enabled: true,
      minutesBefore: 15
    },
    defaultAppointmentDuration: 60,
    
    // Navigation
    navigatorOrder: ['contacts', 'quotes'],
    tabletNavigatorOrder: ['contacts', 'quotes', 'projects', 'calendar'],
    defaultHomeScreen: 'dashboard',
    hiddenNavItems: [],
    showHomeLabel: false,
    showGlobalTemplates: true,
    
    // Communication - CONDITIONAL LOGIC
    communication: {
      phoneProvider: hasGHLSms ? 'ghl_twilio' : 'native',
      defaultPhoneNumber: '',
      showCallButton: true,
      autoLogCalls: true,
      smsProvider: hasGHLSms ? 'ghl_twilio' : 'native',
      smsSignature: '',
      smsTemplatesEnabled: true,
      autoLogSms: true,
      emailProvider: 'default',
      emailTracking: false,
      emailTemplatesEnabled: true,
      autoLogEmails: false,
      videoProvider: 'googlemeet',
      defaultMeetingDuration: 30,
      preferredContactMethod: 'phone',
      communicationHours: {
        enabled: false,
        start: '09:00',
        end: '18:00',
        days: [1, 2, 3, 4, 5],
        timezone: 'America/Denver'
      },
      // Set these only if GHL SMS exists
      ...(hasGHLSms && defaultSmsPhoneNumber ? {
        phoneNumberId: defaultSmsPhoneNumber._id,
        smsNumberId: defaultSmsPhoneNumber._id
      } : {})
    },
    
    // Business Settings
    business: {
      defaultProjectStatus: 'open',
      autoSaveQuotes: true,
      quoteExpirationDays: 30,
      signature: {
        type: 'text',
        value: ''
      },
      defaultTaxRate: 0,
      measurementUnit: 'imperial'
    },
    
    // Privacy Settings
    privacy: {
      showPhoneNumber: true,
      showEmail: true,
      activityTracking: true,
      dataRetentionDays: null
    },
    
    // Mobile Settings
    mobile: {
      offlineMode: true,
      syncOnWifiOnly: false,
      compressImages: true,
      biometricLogin: false,
      stayLoggedIn: true
    }
  };
}

/**
* Sync users from GHL to MongoDB
*/
export async function syncUsers(db: Db, location: any) {
 const startTime = Date.now();
 console.log(`[Sync Users] Starting for ${location.locationId}`);

 try {
   // Get auth header (OAuth or API key)
   const auth = await getAuthHeader(location);
   
   // Fetch users from GHL
   const response = await axios.get(
     'https://services.leadconnectorhq.com/users/',
     {
       headers: {
         'Authorization': auth.header,
         'Version': '2021-07-28',
         'Accept': 'application/json'
       },
       params: {
         locationId: location.locationId
       }
     }
   );

   const ghlUsers = response.data.users || [];
   console.log(`[Sync Users] Found ${ghlUsers.length} users in GHL`);

   // Process each user
   let created = 0;
   let updated = 0;
   let skipped = 0;

   for (const ghlUser of ghlUsers) {
     try {
       // Check if user exists
       const existingUser = await db.collection('users').findOne({
         $or: [
           { ghlUserId: ghlUser.id },
           { email: ghlUser.email, locationId: location.locationId }
         ]
       });

      // Prepare user data
      const userData = {
        // GHL Fields
        ghlUserId: ghlUser.id,
        locationId: location.locationId,
        
        // Basic Info
        email: ghlUser.email,
        name: ghlUser.name || `${ghlUser.firstName || ''} ${ghlUser.lastName || ''}`.trim(),
        firstName: ghlUser.firstName || '',
        lastName: ghlUser.lastName || '',
        phone: ghlUser.phone || '',
        
        // Profile
        avatar: ghlUser.avatar || '',
        
        // Role & Permissions
        role: mapGHLRole(ghlUser.role || ghlUser.roles?.[0]),
        permissions: mapGHLPermissions(ghlUser.permissions || []),
        roles: ghlUser.roles || {
          type: 'account',
          role: mapGHLRole(ghlUser.role || ghlUser.roles?.[0]),
          locationIds: [location.locationId]
        },
        
        // Status
        isActive: ghlUser.deleted !== true && ghlUser.status !== 'inactive',
        
        // GHL Specific Fields
        extension: ghlUser.extension || '',
        dateAdded: ghlUser.dateAdded ? new Date(ghlUser.dateAdded) : null,
        lastLogin: ghlUser.lastLogin ? new Date(ghlUser.lastLogin) : null,
        
        // Additional user-level defaults
        department: ghlUser.department || '',
        emailNotifications: ghlUser.emailNotifications !== undefined ? ghlUser.emailNotifications : true,
        smsNotifications: ghlUser.smsNotifications !== undefined ? ghlUser.smsNotifications : false,
        locale: ghlUser.locale || 'en-US',
        profilePictureUrl: ghlUser.profilePictureUrl || null,
        isVerified: ghlUser.isVerified || false,
        lastLoginAt: ghlUser.lastLogin ? new Date(ghlUser.lastLogin) : null,
        title: ghlUser.title || '',
        isDeleted: ghlUser.deleted === true,
        status: ghlUser.status === 'inactive' ? 'inactive' : 'active',
        
        // Sync Metadata
        lastSyncedAt: new Date(),
        updatedAt: new Date()
      };

      if (existingUser) {
        // Update existing user with defaults for missing fields
        const updateData = {
          ...userData,
          
          // Ensure these fields exist with defaults if missing
          authTokens: existingUser.authTokens || [],
          department: existingUser.department || userData.department,
          emailNotifications: existingUser.emailNotifications !== undefined ? existingUser.emailNotifications : userData.emailNotifications,
          smsNotifications: existingUser.smsNotifications !== undefined ? existingUser.smsNotifications : userData.smsNotifications,
          locale: existingUser.locale || userData.locale,
          profilePictureUrl: existingUser.profilePictureUrl || userData.profilePictureUrl,
          isVerified: existingUser.isVerified !== undefined ? existingUser.isVerified : userData.isVerified,
          title: existingUser.title || userData.title,
          isDeleted: existingUser.isDeleted !== undefined ? existingUser.isDeleted : userData.isDeleted,
          status: existingUser.status || userData.status,
          currentSessionId: existingUser.currentSessionId || null,
          pushToken: existingUser.pushToken || null,
          refreshToken: existingUser.refreshToken || null,
          oneSignalIds: existingUser.oneSignalIds || []
        };

        await db.collection('users').updateOne(
          { _id: existingUser._id },
          { 
            $set: updateData,
            $setOnInsert: { createdAt: new Date() }
          }
        );
        updated++;
        console.log(`[Sync Users] Updated user: ${userData.email}`);
      } else {
         // Create new user with setup token approach
         const setupToken = generateSecureToken();
         const setupTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
         
        const newUser = {
          _id: new ObjectId(),
          ...userData,
          setupToken,
          setupTokenExpiry,
          needsSetup: true,
          hashedPassword: null, // No password yet
          needsPasswordReset: false,
          createdAt: new Date(),
          createdBySync: true,
          onboardingStatus: 'pending',
          preferences: getDefaultPreferences(location),
          requiresReauth: false,
          
          // Additional user-level defaults for new users
          authTokens: [],
          currentSessionId: null,
          pushToken: null,
          refreshToken: null,
          oneSignalIds: []
        };

         await db.collection('users').insertOne(newUser);
         
         // SCHEDULE welcome email with setup link (don't send immediately)
         try {
            // Use onboard emails API endpoint with delay
            setTimeout(async () => {
              await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/onboard/emails`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: ghlUser.email,
                firstName: ghlUser.firstName || ghlUser.email.split('@')[0] || 'User',
                businessName: location.name,
                setupToken,
                setupUrl: `https://www.leadprospecting.ai/setup-password?token=${setupToken}`,
                template: 'welcome'
              })
            });
            }, 5 * 60 * 1000); // 5 minute delay
           console.log(`[Sync Users] Welcome email scheduled for: ${userData.email}`);
         } catch (emailError) {
           console.error(`[Sync Users] Failed to send welcome email to ${userData.email}:`, emailError);
           // Don't fail the user creation if email fails
         }
         
         created++;
         console.log(`[Sync Users] Created user with setup token: ${userData.email}`);
       }
     } catch (userError: any) {
       console.error(`[Sync Users] Error processing user ${ghlUser.email}:`, userError.message);
       skipped++;
     }
   }

   // Get final user count
   const totalUsers = await db.collection('users').countDocuments({ 
     locationId: location.locationId 
   });

   const duration = Date.now() - startTime;
   console.log(`[Sync Users] Completed in ${duration}ms - Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);

   // Publish Ably progress update
   try {
     await publishAblyEvent({
       locationId: location.locationId,
       entity: {
         locationId: location.locationId,
         syncProgress: {
           users: {
             status: 'complete',
             created,
             updated,
             skipped,
             total: totalUsers,
             ghlUserCount: ghlUsers.length,
             completedAt: new Date()
           }
         }
       },
       eventType: 'progress-update',
       metadata: { stepName: 'User Sync' }
     });
   } catch (error) {
     console.error('[Ably] Failed to publish user sync progress:', error);
   }

   return {
     success: true,
     created,
     updated,
     skipped,
     total: totalUsers,
     ghlUserCount: ghlUsers.length,
     duration: `${duration}ms`
   };

 } catch (error: any) {
   console.error(`[Sync Users] Error:`, error.response?.data || error.message);
   
   // Handle specific error cases
   if (error.response?.status === 404) {
     console.log(`[Sync Users] Users endpoint not found`);
     return {
       success: false,
       created: 0,
       updated: 0,
       skipped: 0,
       total: 0,
       error: 'Users endpoint not found'
     };
   }

   if (error.response?.status === 401) {
     console.log(`[Sync Users] Authentication failed`);
     return {
       success: false,
       created: 0,
       updated: 0,
       skipped: 0,
       total: 0,
       error: 'Authentication failed'
     };
   }

   throw error;
 }
}