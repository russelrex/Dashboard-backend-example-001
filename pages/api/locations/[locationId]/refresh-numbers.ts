import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import cors from '@/lib/cors';

interface GHLNumber {
  phoneNumber: string;
  friendlyName: string;
  sid: string;
  isDefaultNumber: boolean;
  capabilities: {
    sms: boolean;
    voice: boolean;
    mms: boolean;
  };
  dateAdded: string;
  dateUpdated: string;
  // Additional GHL fields
  countryCode?: string;
  type?: string;
  origin?: string;
  linkedRingAllUsers?: string[];
  forwardingNumber?: string;
  isGroupConversationEnabled?: boolean;
  addressSid?: string;
  bundleSid?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { locationId } = req.query;
  
  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing locationId' });
  }

  // Verify auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get location with GHL access token
    const location = await db.collection('locations').findOne({ locationId });
    
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const ghlAccessToken = location.ghlOAuth?.accessToken || 
                          location.ghlConfig?.accessToken || 
                          location.accessToken;
    
    if (!ghlAccessToken) {
      return res.status(400).json({ error: 'No GHL access token configured' });
    }

    console.log('🔄 [Refresh Numbers] Fetching from GHL for location:', locationId);

    // Fetch numbers from GHL
    const ghlResponse = await fetch(
      `https://services.leadconnectorhq.com/phone-system/numbers/location/${locationId}`,
      {
        headers: {
          'Accept': 'application/json',
          'Version': '2021-07-28',
          'Authorization': `Bearer ${ghlAccessToken}`
        }
      }
    );

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      console.error('❌ GHL API Error:', errorText);
      return res.status(ghlResponse.status).json({ 
        error: 'Failed to fetch from GHL',
        details: errorText 
      });
    }

    const ghlData = await ghlResponse.json();
    const ghlNumbers: GHLNumber[] = ghlData.numbers || [];

    console.log('✅ [Refresh Numbers] Fetched', ghlNumbers.length, 'numbers from GHL');

    // Get existing numbers (stored at root level, not in settings)
    const existingNumbers = location.smsPhoneNumbers || [];
    
    // Create a map of existing numbers by phone number for quick lookup
    const existingByPhone = new Map();
    existingNumbers.forEach((num: any) => {
      existingByPhone.set(num.number, num);
    });

    // Merge logic - preserve custom labels but sync ALL GHL data
    const mergedNumbers = ghlNumbers
      .filter(ghlNum => ghlNum.capabilities.sms) // Only SMS-capable numbers
      .map(ghlNum => {
        const existing = existingByPhone.get(ghlNum.phoneNumber);
        
        if (existing) {
          // ✅ Update existing number - sync ALL GHL fields but keep custom label
          return {
            // Core identifiers
            _id: typeof existing._id === 'string' ? existing._id : existing._id.toString(), // ✅ Store as string
            number: ghlNum.phoneNumber,
            
            // Labels - preserve custom label if user changed it
            label: existing.label || ghlNum.friendlyName, // ✅ User's custom label takes priority
            friendlyName: ghlNum.friendlyName, // ✅ Store original GHL name separately
            
            // GHL settings - sync everything
            isDefault: ghlNum.isDefaultNumber,
            ghlSid: ghlNum.sid,
            capabilities: ghlNum.capabilities,
            countryCode: ghlNum.countryCode,
            type: ghlNum.type,
            origin: ghlNum.origin,
            
            // Call routing settings
            linkedRingAllUsers: ghlNum.linkedRingAllUsers || [],
            forwardingNumber: ghlNum.forwardingNumber || '',
            isGroupConversationEnabled: ghlNum.isGroupConversationEnabled || false,
            
            // Twilio compliance (optional)
            addressSid: ghlNum.addressSid || null,
            bundleSid: ghlNum.bundleSid || null,
            
            // Tracking
            lastSyncedAt: new Date(),
            addedAt: existing.addedAt || new Date(ghlNum.dateAdded),
            addedBy: existing.addedBy, // Preserve who added it originally
            updatedAt: new Date(),
            
            // GHL timestamps (for reference)
            ghlDateAdded: ghlNum.dateAdded,
            ghlDateUpdated: ghlNum.dateUpdated
          };
        } else {
          // ✅ New number from GHL - store ALL fields
          return {
            // Core identifiers
            _id: new ObjectId().toString(), // ✅ Generate new _id as string
            number: ghlNum.phoneNumber,
            
            // Labels - both start the same for new numbers
            label: ghlNum.friendlyName, // Default to GHL name
            friendlyName: ghlNum.friendlyName, // Store original
            
            // GHL settings
            isDefault: ghlNum.isDefaultNumber,
            ghlSid: ghlNum.sid,
            capabilities: ghlNum.capabilities,
            countryCode: ghlNum.countryCode,
            type: ghlNum.type,
            origin: ghlNum.origin,
            
            // Call routing settings
            linkedRingAllUsers: ghlNum.linkedRingAllUsers || [],
            forwardingNumber: ghlNum.forwardingNumber || '',
            isGroupConversationEnabled: ghlNum.isGroupConversationEnabled || false,
            
            // Twilio compliance (optional)
            addressSid: ghlNum.addressSid || null,
            bundleSid: ghlNum.bundleSid || null,
            
            // Tracking
            lastSyncedAt: new Date(),
            addedAt: new Date(ghlNum.dateAdded),
            addedBy: decoded.userId, // Track who synced it
            updatedAt: new Date(),
            
            // GHL timestamps (for reference)
            ghlDateAdded: ghlNum.dateAdded,
            ghlDateUpdated: ghlNum.dateUpdated
          };
        }
      });

    console.log('🔀 [Refresh Numbers] Merged:', {
      ghlCount: ghlNumbers.length,
      existingCount: existingNumbers.length,
      mergedCount: mergedNumbers.length
    });

    console.log('📝 [Refresh Numbers] About to save to DB:');
    console.log('First number:', JSON.stringify(mergedNumbers[0], null, 2));

    // Update location - unset first to force full replacement
    await db.collection('locations').updateOne(
      { locationId },
      { 
        $unset: { smsPhoneNumbers: "" }
      }
    );

    await db.collection('locations').updateOne(
      { locationId },
      { 
        $set: { 
          smsPhoneNumbers: mergedNumbers,
          smsConfigUpdatedAt: new Date(),
          lastNumberSync: new Date()
        } 
      }
    );

    console.log('✅ [Refresh Numbers] Updated location settings');

    // 🎯 SET DEFAULT SMS NUMBER & UPDATE ALL USERS
    console.log('📋 [Refresh Numbers] Phone numbers summary:');
    mergedNumbers.forEach((num, index) => {
      console.log(`  ${index + 1}. ${num.number} (${num.label}) - SMS: ${num.capabilities.sms ? '✅' : '❌'}`);
    });

    // Find first SMS-capable number
    const defaultSmsNumber = mergedNumbers.find(num => num.capabilities.sms);
    
    if (defaultSmsNumber) {
      console.log(`🎯 [Refresh Numbers] Setting default SMS number: ${defaultSmsNumber.number}`);
      
      // Set as default in the numbers array
      const numbersWithDefault = mergedNumbers.map(num => ({
        ...num,
        isDefault: num.number === defaultSmsNumber.number
      }));
      
      // Update location with default number marked
      await db.collection('locations').updateOne(
        { locationId },
        { 
          $set: { 
            smsPhoneNumbers: numbersWithDefault,
            'settings.defaultSmsNumber': defaultSmsNumber.number, // Store at settings level too
            smsConfigUpdatedAt: new Date()
          } 
        }
      );
      
      // 👥 UPDATE ALL USERS FOR THIS LOCATION
      const users = await db.collection('users').find({ 
        locationId,
        isActive: { $ne: false }
      }).toArray();
      
      console.log(`👥 [Refresh Numbers] Updating ${users.length} users with default SMS number`);
      
      // Update each user's preferences
      for (const user of users) {
        await db.collection('users').updateOne(
          { _id: user._id },
          {
            $set: {
              'preferences.communication.phoneProvider': 'native',
              'preferences.communication.defaultPhoneNumber': defaultSmsNumber.number,
              'preferences.communication.smsProvider': 'native',
              updatedAt: new Date().toISOString()
            }
          }
        );
      }
      
      console.log(`✅ [Refresh Numbers] Updated ${users.length} users to use native provider with ${defaultSmsNumber.number}`);
    } else {
      console.log('⚠️ [Refresh Numbers] No SMS-capable numbers found');
    }

    return res.status(200).json({
      success: true,
      numbers: mergedNumbers,
      summary: {
        total: mergedNumbers.length,
        new: mergedNumbers.filter(n => !existingByPhone.has(n.number)).length,
        updated: mergedNumbers.filter(n => existingByPhone.has(n.number)).length
      }
    });

  } catch (error: any) {
    console.error('❌ [Refresh Numbers] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to refresh numbers',
      message: error.message 
    });
  }
}
