/**
 * File: email-templates.ts
 * Purpose: Email templates API endpoint
 * Author: LPai Team
 * Last Modified: 2025-09-09
 * Dependencies: MongoDB, JWT auth
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { category, locationId } = req.query;

    if (!locationId) {
      return res.status(400).json({ error: 'locationId is required' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Query for both location-specific and global templates
    const query: any = {
      $or: [
        { locationId: locationId },
        { isGlobal: true }
      ],
      isActive: true
    };

    if (category) {
      query.category = category;
    }

    const templates = await db.collection('email_templates')
      .find(query)
      .sort({ name: 1 })
      .toArray();

    return res.status(200).json({
      success: true,
      templates: templates || []
    });

  } catch (error: any) {
    console.error('[Email Templates API] Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to fetch email templates',
      details: error.message 
    });
  }
}