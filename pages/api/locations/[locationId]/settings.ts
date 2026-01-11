/**
 * File: settings.ts
 * Purpose: Manage location-specific settings including enabled industries
 * Author: LPai Team
 * Last Modified: 2025-10-23
 * Location Context: Multi-location support required
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '@/lib/cors';
import {
  sendSuccess,
  sendServerError,
} from '../../../../src/utils/httpResponses';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  const { locationId } = req.query;
  
  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing locationId' });
  }

    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (req.method) {
      case 'GET':
      return await getSettings(db, locationId, res);
    case 'PATCH':
      return await updateSettings(db, locationId, req.body, res);
    default:
      res.setHeader('Allow', ['GET', 'PATCH']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getSettings(db: any, locationId: string, res: NextApiResponse) {
  try {
    const location = await db.collection('locations').findOne({ locationId });
    
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    // Disable caching
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // Construct the settings object - everything nested under 'settings' key
    const settingsResponse = {
      settings: {
        ...location.settings, // Base settings (quoteDefaults, preferences, etc.)
        pipelineSettings: location.pipelineSettings || {
          projectsPipelines: [],
          quotesPipelines: [],
          defaultProjectsPipelineId: '',
          defaultQuotesPipelineId: ''
        },
        calendarSettings: location.calendarSettings || {
          projectsCalendars: [],
          quotesCalendars: [],
          displayCalendars: [],
          defaultProjectsCalendarId: '',
          defaultQuotesCalendarId: ''
        },
        contactSettings: location.contactSettings || {
          displayFilters: {
            tagFilters: [],
            excludeTagFilters: [],
            statusFilters: [],
            sourceFilters: [],
            typeFilters: [],
            assignedToFilters: [],
            companyFilters: [],
            customFieldFilters: []
          },
          filterMode: 'inclusive',
          showAllByDefault: true,
          autoHideLeads: false,
          hideUnassigned: false
        }
      }
    };
    
    return sendSuccess(res, settingsResponse, 'Settings fetched successfully');
  } catch (error) {
    console.error('[SETTINGS API] Error fetching settings:', error);
    return sendServerError(res, error, 'Failed to fetch settings');
  }
}

async function updateSettings(db: any, locationId: string, body: any, res: NextApiResponse) {
  try {
    const { settingType, data, enabledLibraryIds, hiddenGlobalItems } = body;
    
    // Build update object dynamically
    const updates: any = { updatedAt: new Date().toISOString() };
    
    // Handle new settingType approach (used by locationService.updateSetting)
    if (settingType && data !== undefined) {
      // Map settingType to the correct database path
      switch (settingType) {
        case 'pipelineSettings':
          updates['pipelineSettings'] = data;
          updates['pipelineSettingsUpdatedAt'] = new Date().toISOString();
          break;
        case 'calendarSettings':
          updates['calendarSettings'] = data;
          updates['calendarSettingsUpdatedAt'] = new Date().toISOString();
          break;
        case 'contactSettings':
          updates['contactSettings'] = data;
          updates['contactSettingsUpdatedAt'] = new Date().toISOString();
          break;
        case 'preferences':
          updates['settings.preferences'] = data;
          updates['preferencesUpdatedAt'] = new Date().toISOString();
          break;
        case 'quoteDefaults':
          updates['settings.quoteDefaults'] = data;
          updates['quoteDefaultsUpdatedAt'] = new Date().toISOString();
          break;
        case 'smsPhoneNumbers':
          updates['smsPhoneNumbers'] = data;
          updates['smsConfigUpdatedAt'] = new Date().toISOString();
          break;
        default:
          return res.status(400).json({ error: `Unknown settingType: ${settingType}` });
      }
    }
    
    // Handle legacy library settings approach
    if (enabledLibraryIds !== undefined) {
      if (!Array.isArray(enabledLibraryIds)) {
        return res.status(400).json({ error: 'enabledLibraryIds must be an array' });
      }
      updates['settings.enabledLibraryIds'] = enabledLibraryIds;
    }
    
    if (hiddenGlobalItems !== undefined) {
      if (!Array.isArray(hiddenGlobalItems)) {
        return res.status(400).json({ error: 'hiddenGlobalItems must be an array' });
      }
      updates['settings.hiddenGlobalItems'] = hiddenGlobalItems;
    }
    
    // Must have at least one update
    if (Object.keys(updates).length === 1) { // Only has updatedAt
      return res.status(400).json({ error: 'No valid settings provided to update' });
    }
    
    const result = await db.collection('locations').updateOne(
      { locationId },
      { $set: updates }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    console.log(`[SETTINGS API] Updated settings for ${locationId}:`, updates);
    return sendSuccess(res, { modifiedCount: result.modifiedCount }, 'Settings updated successfully');
  } catch (error) {
    console.error('[SETTINGS API] Error updating settings:', error);
    return sendServerError(res, error, 'Failed to update settings');
  }
}