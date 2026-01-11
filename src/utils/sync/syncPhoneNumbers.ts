/**
 * File: syncPhoneNumbers.ts
 * Purpose: Sync SMS phone numbers from GHL during installation
 * Author: LPai Team
 * Last Modified: 2025-01-14
 * Dependencies: GHL Phone API, MongoDB
 */

import { ObjectId } from 'mongodb';

interface GHLNumber {
  phoneNumber: string;
  friendlyName: string;
  sid: string;
  isDefaultNumber: boolean;
  capabilities: {
    sms: boolean;
    voice: boolean;
    mms: boolean;
    fax: boolean;
  };
  dateAdded: string;
  dateUpdated: string;
}

export async function syncPhoneNumbers(db: any, location: any) {
  console.log(`[Sync Phone Numbers] Starting for location: ${location.locationId}`);
  
  const startTime = Date.now();
  const result = {
    fetched: 0,
    stored: 0,
    error: null as string | null
  };

  try {
    // Get GHL access token
    const ghlAccessToken = location.ghlOAuth?.accessToken || 
                          location.ghlConfig?.accessToken || 
                          location.accessToken;
    
    if (!ghlAccessToken) {
      console.log(`[Sync Phone Numbers] No GHL access token available`);
      return { ...result, error: 'No GHL access token' };
    }

    // Fetch phone numbers from GHL
    const ghlResponse = await fetch(
      `https://services.leadconnectorhq.com/phone-system/numbers/location/${location.locationId}`,
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
      console.error(`[Sync Phone Numbers] GHL API Error:`, errorText);
      return { ...result, error: `GHL API Error: ${ghlResponse.status}` };
    }

    const ghlData = await ghlResponse.json();
    const ghlNumbers: GHLNumber[] = ghlData.numbers || [];
    
    result.fetched = ghlNumbers.length;
    console.log(`[Sync Phone Numbers] Fetched ${result.fetched} numbers from GHL`);

    // Filter for SMS-capable numbers and format for storage
    const smsNumbers = ghlNumbers
      .filter(num => num.capabilities.sms)
      .map(num => ({
        _id: new ObjectId(),
        number: num.phoneNumber,
        label: num.friendlyName,
        isDefault: num.isDefaultNumber,
        ghlSid: num.sid,
        capabilities: num.capabilities,
        lastSyncedAt: new Date(),
        addedAt: new Date(num.dateAdded),
        updatedAt: new Date()
      }));

    result.stored = smsNumbers.length;

    if (smsNumbers.length > 0) {
      // Store at ROOT level to match existing pattern
      await db.collection('locations').updateOne(
        { _id: location._id },
        {
          $set: {
            smsPhoneNumbers: smsNumbers,  // ✅ Root level, not settings.smsPhoneNumbers
            smsConfigUpdatedAt: new Date(),
            lastNumberSync: new Date()
          }
        }
      );

      console.log(`[Sync Phone Numbers] Stored ${result.stored} SMS-capable numbers`);
    } else {
      console.log(`[Sync Phone Numbers] No SMS-capable numbers found`);
    }

    const duration = Date.now() - startTime;
    console.log(`[Sync Phone Numbers] Completed in ${duration}ms`);

    return result;

  } catch (error: any) {
    console.error(`[Sync Phone Numbers] Error:`, error);
    return { ...result, error: error.message };
  }
}
