// pages/api/team/members.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import jwt from 'jsonwebtoken';

// Auth middleware
async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authUser = await verifyAuth(req);
    
    const { locationId } = req.query;
    
    if (!locationId) {
      return res.status(400).json({ error: 'Location ID required' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get ALL users for this location - no filtering
    const users = await db.collection('users')
      .find({ 
        locationId: locationId as string,
        // Don't filter by active, isDeleted, etc - get ALL users
      })
      .toArray();

    console.log(`[Team Members API] Found ${users.length} users for location ${locationId}`);

    // Transform to consistent format
    const teamMembers = users.map(user => ({
      _id: user._id,
      userId: user.userId || user.ghlUserId || user._id,
      name: user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email?.split('@')[0] || 'Unknown',
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role || user.roles?.role || 'user',
      locationId: user.locationId,
      isActive: user.isActive !== false, // Default to true if not specified
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));

    return res.status(200).json({ 
      success: true,
      users: teamMembers,
      total: teamMembers.length
    });

  } catch (error: any) {
    console.error('[Team Members API] Error:', error);
    
    if (error.message === 'No token provided' || error.message === 'Invalid token') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    return res.status(500).json({ 
      error: 'Failed to fetch team members',
      message: error.message 
    });
  }
}