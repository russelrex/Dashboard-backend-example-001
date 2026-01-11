import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import {
  sendSuccess,
  sendServerError,
  sendBadRequest,
  sendNotFound
} from '@/utils/httpResponses';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  const client = await clientPromise;
  const db = client.db(getDbName());
  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return sendBadRequest(res, 'locationId is required');
  }

  switch (req.method) {
    case 'GET':
      return await getSettings(db, locationId, res);

    case 'POST':
      return await createOrUpdateSettings(db, locationId, req.body, res);

    default:
      return res.status(405).json({
        success: false,
        message: 'Method Not Allowed',
        error: `Only GET and POST are allowed`,
      });
  }
}

async function getSettings(db: any, locationId: string, res: NextApiResponse) {
  try {
    const setting = await db.collection('settings').findOne({ locationId });

    if (!setting) {
      return sendNotFound(res, 'No settings found for this location');
    }

    return sendSuccess(res, setting, 'Settings fetched successfully');
  } catch (error) {
    console.error('Error fetching settings:', error);
    return sendServerError(res, error, 'Failed to fetch settings');
  }
}

async function createOrUpdateSettings(db: any, locationId: string, body: any, res: NextApiResponse) {
  try {
    if (!body.libraryId) {
      return sendBadRequest(res, 'libraryId is required');
    }

    const settingsCollection = db.collection('settings');

    const now = new Date().toISOString();

    const settingsPayload = {
      locationId,
      settings: {
        libraryId: body.libraryId,
      },
      updatedAt: now,
    };

    const existing = await settingsCollection.findOne({ locationId });

    if (existing) {
      await settingsCollection.updateOne(
        { locationId },
        {
          $set: settingsPayload
        }
      );
      const updated = await settingsCollection.findOne({ locationId });
      console.log(`Updated settings for location ${locationId}`);
      return sendSuccess(res, updated, 'Settings updated successfully');
    } else {
      const newSettings = {
        ...settingsPayload,
        createdAt: now,
      };
      const result = await settingsCollection.insertOne(newSettings);
      const created = { ...newSettings, _id: result.insertedId };
      console.log(`Created settings for location ${locationId}`);
      return sendSuccess(res, created, 'Settings created successfully');
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    return sendServerError(res, error, 'Failed to save settings');
  }
}
