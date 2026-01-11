// pages/api/team/channels/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
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

// Default channels for new locations
const DEFAULT_CHANNELS = [
  {
    id: 'general',
    name: 'general',
    description: 'Company-wide announcements and general discussion',
    type: 'general',
    icon: 'megaphone-outline',
    isPrivate: false,
    permissions: { canPost: 'everyone' },
    isDefault: true,
  },
  {
    id: 'projects',
    name: 'projects',
    description: 'Project updates and discussions',
    type: 'project',
    icon: 'briefcase-outline',
    isPrivate: false,
    permissions: { canPost: 'everyone' },
    isDefault: true,
  },
  {
    id: 'quotes',
    name: 'quotes',
    description: 'Quote discussions and approvals',
    type: 'quote',
    icon: 'document-text-outline',
    isPrivate: false,
    permissions: { canPost: 'everyone' },
    isDefault: true,
  },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUser = await verifyAuth(req);
    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (req.method) {
      case 'GET':
        return await getChannels(req, res, db, authUser);
      case 'POST':
        return await createChannel(req, res, db, authUser);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('[Channels API] Error:', error);
    
    if (error.message === 'No token provided' || error.message === 'Invalid token') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

async function getChannels(
  req: NextApiRequest, 
  res: NextApiResponse, 
  db: any,
  authUser: any
) {
  const { locationId } = req.query;
  
  if (!locationId) {
    return res.status(400).json({ error: 'Location ID required' });
  }

  // Get custom channels
  const customChannels = await db.collection('channels')
    .find({ 
      locationId: locationId as string,
      deleted: { $ne: true }
    })
    .toArray();

  // Get member counts for channels
  const channelsWithCounts = await Promise.all([
    ...DEFAULT_CHANNELS.map(async (channel) => ({
      ...channel,
      locationId: locationId as string,
      memberCount: await db.collection('channel_members').countDocuments({
        locationId: locationId as string,
        channelId: channel.id
      })
    })),
    ...customChannels.map(async (channel: any) => ({
      ...channel,
      id: channel._id.toString(),
      memberCount: await db.collection('channel_members').countDocuments({
        locationId: locationId as string,
        channelId: channel._id.toString()
      })
    }))
  ]);

  // Get unread counts for user
  const unreadCounts = await db.collection('channel_unreads')
    .find({
      locationId: locationId as string,
      userId: authUser.userId
    })
    .toArray();

  const unreadMap = new Map(
    unreadCounts.map((u: any) => [u.channelId, u.count])
  );

  // Add unread counts to channels
  const channelsWithUnread = channelsWithCounts.map(channel => ({
    ...channel,
    unreadCount: unreadMap.get(channel.id) || 0
  }));

  return res.status(200).json({ 
    channels: channelsWithUnread,
    total: channelsWithUnread.length
  });
}

async function createChannel(
  req: NextApiRequest,
  res: NextApiResponse,
  db: any,
  authUser: any
) {
  const { locationId, name, description, type = 'custom', isPrivate = false, permissions } = req.body;

  if (!locationId || !name) {
    return res.status(400).json({ error: 'Location ID and name required' });
  }

  // Check if user is admin
  const user = await db.collection('users').findOne({
    _id: new ObjectId(authUser._id),
    locationId
  });

  if (!user || (user.role !== 'admin' && user.roles?.role !== 'admin')) {
    return res.status(403).json({ error: 'Only admins can create channels' });
  }

  // Validate channel name
  const cleanName = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  
  // Check if channel already exists
  const existing = await db.collection('channels').findOne({
    locationId,
    name: cleanName,
    deleted: { $ne: true }
  });

  if (existing) {
    return res.status(400).json({ error: 'Channel already exists' });
  }

  // Create channel
  const channel = {
    locationId,
    name: cleanName,
    displayName: name,
    description,
    type,
    icon: type === 'project' ? 'briefcase-outline' : 
          type === 'quote' ? 'document-text-outline' : 
          'chatbubbles-outline',
    isPrivate,
    permissions: permissions || { canPost: 'everyone' },
    createdBy: authUser.userId,
    createdAt: new Date(),
    updatedAt: new Date(),
    deleted: false
  };

  const result = await db.collection('channels').insertOne(channel);

  // Add creator as member if private
  if (isPrivate) {
    await db.collection('channel_members').insertOne({
      locationId,
      channelId: result.insertedId.toString(),
      userId: authUser.userId,
      role: 'owner',
      joinedAt: new Date()
    });
  }

  return res.status(201).json({ 
    channel: {
      ...channel,
      id: result.insertedId.toString(),
      _id: result.insertedId,
      memberCount: isPrivate ? 1 : 0
    }
  });
}