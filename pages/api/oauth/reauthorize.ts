/**
 * File: reauthorize.ts
 * Purpose: Handle re-authorization when refresh token expires
 * Author: LPai Team
 * Last Modified: 2025-09-01
 * Dependencies: MongoDB, GHL OAuth
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { locationId, client_id } = req.query;
  
  if (!locationId) {
    return res.status(400).json({ error: 'locationId required' });
  }

  // Determine which app credentials to use
  let appCredentials;
  if (client_id === process.env.GHL_FIELDSERV_CLIENT_ID) {
    appCredentials = {
      client_id: process.env.GHL_FIELDSERV_CLIENT_ID,
      client_secret: process.env.GHL_FIELDSERV_CLIENT_SECRET
    };
  } else if (client_id === process.env.GHL_MARKETPLACE_CLIENT_ID) {
    appCredentials = {
      client_id: process.env.GHL_MARKETPLACE_CLIENT_ID,
      client_secret: process.env.GHL_MARKETPLACE_CLIENT_SECRET
    };
  } else {
    // Fallback to marketplace for backward compatibility
    appCredentials = {
      client_id: process.env.GHL_MARKETPLACE_CLIENT_ID,
      client_secret: process.env.GHL_MARKETPLACE_CLIENT_SECRET
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Build the OAuth authorization URL
    const redirectUri = `${process.env.NEXT_PUBLIC_API_URL || 'https://lpai-backend-omega.vercel.app'}/api/oauth/callback`;
    
    // Include the locationId in the state or as a parameter
    const authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?` +
      `response_type=code&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `client_id=${appCredentials.client_id}&` +
      `scope=businesses.readonly businesses.write calendars.readonly calendars.write contacts.readonly contacts.write conversations.readonly conversations.write locations.readonly oauth.readonly oauth.write opportunities.readonly opportunities.write users.readonly&` +
      `locationId=${locationId}`;

    // Mark location as needing re-auth
    await db.collection('locations').updateOne(
      { locationId },
      {
        $set: {
          'ghlOAuth.needsReauth': true,
          'ghlOAuth.reAuthUrl': authUrl,
          'ghlOAuth.reAuthRequestedAt': new Date()
        }
      }
    );

    // Redirect to GHL OAuth
    res.redirect(authUrl);
    
  } catch (error: any) {
    console.error('[ReAuthorize] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}