// pages/api/locations/[locationId]/tags.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import jwt from 'jsonwebtoken';
import axios from 'axios';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { locationId } = req.query;
    
    if (!locationId || typeof locationId !== 'string') {
      return res.status(400).json({ error: 'Invalid locationId' });
    }

    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;

    if (!decoded?.userId) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Check if user belongs to this location
    const user = await db.collection('users').findOne({
      ghlUserId: decoded.userId,
      locationId: locationId
    });

    if (!user) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get location for GHL auth - same pattern as SMS send
    const location = await db.collection('locations').findOne({ locationId });
    
    if (!location?.ghlOAuth?.accessToken) {
      return res.status(400).json({ error: 'No OAuth token found for location' });
    }

    // Check if we have cached tags that are less than 1 hour old
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (location.cachedTags && location.lastTagsSync && new Date(location.lastTagsSync) > oneHourAgo) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Tags API] Using cached tags for location ${locationId}`);
      }
      
      return res.status(200).json({
        success: true,
        tags: location.cachedTags,
        count: location.cachedTags.length,
        cached: true,
        lastSync: location.lastTagsSync
      });
    }

    // Fetch fresh tags from GHL - using exact same pattern as your working axios call
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Tags API] Fetching fresh tags from GHL for location ${locationId}`);
      }

      const options = {
        method: 'GET',
        url: `https://services.leadconnectorhq.com/locations/${locationId}/tags`,
        headers: {
          Authorization: `Bearer ${location.ghlOAuth.accessToken}`,
          Version: '2021-07-28',
          Accept: 'application/json'
        },
        timeout: 10000 // 10 second timeout
      };

      const { data } = await axios.request(options);
      const ghlTags = data.tags || [];
      
      // Transform GHL tags to simple string array
      const tags = ghlTags.map((tag: any) => {
        return typeof tag === 'string' ? tag : tag.name || tag.label || tag.value || '';
      }).filter((tag: string) => tag && tag.trim());

      // Cache the tags in location document
      await db.collection('locations').updateOne(
        { locationId },
        {
          $set: {
            cachedTags: tags,
            lastTagsSync: new Date()
          }
        }
      );

      if (process.env.NODE_ENV === 'development') {
        console.log(`[Tags API] Cached ${tags.length} tags for location ${locationId}`);
      }

      return res.status(200).json({
        success: true,
        tags,
        count: tags.length,
        cached: false,
        lastSync: new Date()
      });

    } catch (ghlError: any) {
      console.error('[Tags API] GHL request failed:', ghlError.message);
      
      // Fallback to cached tags if available, even if expired
      if (location.cachedTags && location.cachedTags.length > 0) {
        console.log('[Tags API] Using stale cached tags as fallback');
        
        return res.status(200).json({
          success: true,
          tags: location.cachedTags,
          count: location.cachedTags.length,
          cached: true,
          stale: true,
          lastSync: location.lastTagsSync,
          warning: 'Using cached tags due to GHL sync failure'
        });
      }
      
      // If no cached tags and GHL fails, return empty array
      return res.status(200).json({
        success: true,
        tags: [],
        count: 0,
        cached: false,
        error: 'Failed to fetch tags from GHL'
      });
    }

  } catch (error: any) {
    console.error('[Tags API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch tags',
      message: error.message,
      // Include more details in development
      ...(process.env.NODE_ENV === 'development' && { 
        stack: error.stack,
        details: error 
      })
    });
  }
}