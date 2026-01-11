// lpai-backend/pages/api/users/[userId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import cors from '@/lib/cors';

// Default preferences for all users
const DEFAULT_USER_PREFERENCES = {
  // Display & UI
  notifications: true,
  defaultCalendarView: 'week',
  emailSignature: '',
  theme: 'system',
  
  // Localization
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Denver',
  dateFormat: 'MM/DD/YYYY',
  timeFormat: '12h',
  firstDayOfWeek: 0, // Sunday
  language: 'en',
  
  // Calendar & Scheduling
  workingHours: {
    enabled: true,
    start: '09:00',
    end: '17:00',
    days: [1, 2, 3, 4, 5], // Mon-Fri
  },
  appointmentReminders: {
    enabled: true,
    minutesBefore: 15,
  },
  defaultAppointmentDuration: 60,
  
  // Navigation & Workflow
  navigatorOrder: ['home', 'calendar', 'contacts'],
  defaultHomeScreen: 'dashboard',
  hiddenNavItems: [],
  showHomeLabel: false,
  
  // Communication Settings
  communication: {
    // Phone
    phoneProvider: 'native',
    defaultPhoneNumber: '',
    showCallButton: true,
    autoLogCalls: false,
    
    // SMS
    smsProvider: 'native',
    smsSignature: '',
    smsTemplatesEnabled: true,
    autoLogSms: false,
    
    // Email
    emailProvider: 'default',
    emailTracking: false,
    emailTemplatesEnabled: true,
    autoLogEmails: false,
    
    // Video
    videoProvider: 'googlemeet',
    defaultMeetingDuration: 30,
    
    // General
    preferredContactMethod: 'phone',
    communicationHours: {
      enabled: false,
      start: '09:00',
      end: '18:00',
      days: [1, 2, 3, 4, 5],
      timezone: 'America/Denver',
    },
  },
  
  // Business Settings
  business: {
    defaultProjectStatus: 'open',
    autoSaveQuotes: true,
    quoteExpirationDays: 30,
    signature: {
      type: 'text',
      value: '',
    },
    defaultTaxRate: 0,
    measurementUnit: 'imperial',
  },
  
  // Privacy & Security
  privacy: {
    showPhoneNumber: true,
    showEmail: true,
    activityTracking: true,
    dataRetentionDays: null,
  },
  
  // Mobile Settings
  mobile: {
    offlineMode: true,
    syncOnWifiOnly: false,
    compressImages: true,
    biometricLogin: false,
    stayLoggedIn: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { userId } = req.query;
  
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid userId' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  switch (req.method) {
    case 'GET':
      return await getUser(db, userId, res);
    case 'PATCH':
      return await updateUser(db, userId, req.body, res);
    case 'DELETE':
      return await softDeleteUser(db, userId, req, res);
    default:
      res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

// 📋 GET: Fetch user details
async function getUser(db: any, userId: string, res: NextApiResponse) {
  try {
    let user;
    
    // Try to find by ObjectId first, then by userId field
    if (ObjectId.isValid(userId)) {
      user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    }
    
    if (!user) {
      user = await db.collection('users').findOne({ userId: userId });
    }
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user is deleted
    if (user.deletedAt || user.isDeleted) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Merge default preferences with user preferences
    if (!user.preferences) {
      user.preferences = DEFAULT_USER_PREFERENCES;
    } else {
      // Deep merge to ensure all new fields have defaults
      user.preferences = deepMergePreferences(DEFAULT_USER_PREFERENCES, user.preferences);
    }
    
    console.log(`[USERS API] Fetched user: ${user.name} (${user.email})`);
    return res.status(200).json(user);
    
  } catch (error) {
    console.error('[USERS API] Error fetching user:', error);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
}

// ✏️ PATCH: Update user (mainly for preferences)
async function updateUser(db: any, userId: string, body: any, res: NextApiResponse) {
  // 🚨 FORCE LOGS TO APPEAR
  console.error('🚨🚨🚨 [USERS API] PATCH REQUEST RECEIVED 🚨🚨🚨');
  console.error('[USERS API] User ID:', userId);
  console.error('[USERS API] Body keys:', Object.keys(body));
  console.error('[USERS API] Full body:', JSON.stringify(body));
  
  try {
    const { preferences, ...otherUpdates } = body;
    
    // Find user
    let currentUser;
    if (ObjectId.isValid(userId) && userId.length === 24) {
      currentUser = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    }
    
    if (!currentUser) {
      currentUser = await db.collection('users').findOne({ userId: userId });
    }
    
    if (!currentUser) {
      console.error('[USERS API] ❌ User not found');
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.error('[USERS API] ✅ Found user:', currentUser.email);
    console.error('[USERS API] Current DB smsNumberId:', currentUser.preferences?.communication?.smsNumberId);
    
    let updateData: any = {};
    
    // Handle preferences
    if (preferences) {
      console.error('[USERS API] 🔥 PREFERENCES UPDATE DETECTED');
      
      const existingPreferences = currentUser.preferences || {};
      
      // Simple deep merge - CRITICAL FIX
      updateData.preferences = {
        ...existingPreferences,
        ...preferences,
        communication: {
          ...existingPreferences.communication,
          ...preferences.communication
        }
      };
      
      console.error('[USERS API] After merge - smsNumberId:', updateData.preferences.communication?.smsNumberId);
    }
    
    // Handle other user fields
    if (otherUpdates.invitedToApp !== undefined) {
      updateData.invitedToApp = otherUpdates.invitedToApp;
    }

    updateData = { ...updateData, ...otherUpdates };
    
    // Add timestamp
    updateData.updatedAt = new Date();
    
    console.error('[USERS API] 💾 SAVING TO MONGODB');
    
    // Perform update
    const result = await db.collection('users').updateOne(
      { _id: currentUser._id },
      { $set: updateData }
    );
    
    console.error('[USERS API] MongoDB result:', result.matchedCount, 'matched,', result.modifiedCount, 'modified');
    
    // Fetch updated user
    const updatedUser = await db.collection('users').findOne({ _id: currentUser._id });
    
    console.error('[USERS API] ✅ VERIFICATION - smsNumberId in DB:', updatedUser.preferences?.communication?.smsNumberId);
    
    return res.status(200).json(updatedUser);
    
  } catch (error) {
    console.error('[USERS API] ❌ ERROR:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
}

// 🗑️ DELETE: Soft delete user
async function softDeleteUser(db: any, userId: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    console.log('[USERS API] Soft delete request for userId:', userId);
    
    // Find the user first
    let currentUser;
    
    if (ObjectId.isValid(userId) && userId.length === 24) {
      currentUser = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    }
    
    if (!currentUser) {
      currentUser = await db.collection('users').findOne({ userId: userId });
    }
    
    if (!currentUser) {
      currentUser = await db.collection('users').findOne({ ghlUserId: userId });
    }
    
    if (!currentUser) {
      console.log('[USERS API] User not found for deletion');
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already deleted
    if (currentUser.deletedAt || currentUser.isDeleted) {
      return res.status(400).json({ error: 'User already deleted' });
    }
    
    // Create deletion record
    const deletionInfo = {
      isDeleted: true,
      deletedAt: new Date().toISOString(),
      deletionDetails: {
        reason: 'user_requested',
        deletedBy: userId,
        originalEmail: currentUser.email, // Store original email for records
        originalPhone: currentUser.phone, // Store original phone for records
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      }
    };
    
    // Perform soft delete - anonymize personal data but keep the record
    const result = await db.collection('users').updateOne(
      { _id: currentUser._id },
      { 
        $set: {
          ...deletionInfo,
          
          // Anonymize personal data
          name: 'Deleted User',
          firstName: 'Deleted',
          lastName: 'User',
          email: `deleted_${currentUser._id}@removed.com`,
          phone: null,
          avatar: null,
          
          // Clear sensitive preferences
          'preferences.communication': {},
          'preferences.privacy': {},
          
          // Disable all access
          isActive: false,
          
          // Clear tokens
          refreshToken: null,
          pushToken: null,
          
          // Keep these for data integrity
          // _id, userId, locationId, createdAt, projects, quotes, etc.
        }
      }
    );
    
    if (!result.modifiedCount) {
      console.log('[USERS API] Soft delete failed');
      return res.status(500).json({ error: 'Failed to delete user' });
    }
    
    console.log(`[USERS API] Successfully soft deleted user: ${currentUser._id}`);
    
    // Optional: Create audit log entry
    try {
      await db.collection('audit_logs').insertOne({
        action: 'user_account_deleted',
        userId: currentUser._id,
        userEmail: deletionInfo.deletionDetails.originalEmail,
        timestamp: new Date().toISOString(),
        ip: deletionInfo.deletionDetails.ip,
        userAgent: deletionInfo.deletionDetails.userAgent,
        details: {
          reason: 'user_requested',
          method: 'soft_delete'
        }
      });
    } catch (auditError) {
      console.error('[USERS API] Failed to create audit log:', auditError);
      // Don't fail the deletion if audit log fails
    }
    
    // Optional: Update related collections to show "Deleted User"
    // This helps maintain data integrity while protecting privacy
    const updatePromises = [];
    
    // Update projects
    updatePromises.push(
      db.collection('projects').updateMany(
        { userId: currentUser._id.toString() },
        { 
          $set: { 
            userName: 'Deleted User',
            userDeleted: true
          } 
        }
      )
    );
    
    // Update quotes
    updatePromises.push(
      db.collection('quotes').updateMany(
        { userId: currentUser._id.toString() },
        { 
          $set: { 
            userName: 'Deleted User',
            userDeleted: true
          } 
        }
      )
    );
    
    // Update appointments
    updatePromises.push(
      db.collection('appointments').updateMany(
        { userId: currentUser._id.toString() },
        { 
          $set: { 
            userName: 'Deleted User',
            userDeleted: true
          } 
        }
      )
    );
    
    // Execute all updates
    try {
      await Promise.all(updatePromises);
      console.log('[USERS API] Updated related collections for deleted user');
    } catch (updateError) {
      console.error('[USERS API] Error updating related collections:', updateError);
      // Don't fail - user is already marked as deleted
    }
    
    return res.status(200).json({ 
      success: true,
      message: 'Account successfully deleted',
      deletedAt: deletionInfo.deletedAt
    });
    
  } catch (error) {
    console.error('[USERS API] Error soft deleting user:', error);
    return res.status(500).json({ error: 'Failed to delete user account' });
  }
}

// Deep merge helper function
function deepMergePreferences(base: any, updates: any): any {
  const result = { ...base };
  
  for (const key in updates) {
    if (updates[key] === null || updates[key] === undefined) {
      result[key] = updates[key];
    } else if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
      // Recursively merge nested objects
      result[key] = deepMergePreferences(base[key] || {}, updates[key]);
    } else {
      // Direct value assignment (including arrays)
      result[key] = updates[key];
    }
  }
  
  return result;
}