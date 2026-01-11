// pages/api/team/channels/[channelId].ts
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authUser = await verifyAuth(req);
    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (req.method) {
      case 'PUT':
        return await updateChannel(req, res, db, authUser);
      case 'DELETE':
        return await deleteChannel(req, res, db, authUser);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('[Channel API] Error:', error);
    
    if (error.message === 'No token provided' || error.message === 'Invalid token') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

async function updateChannel(
  req: NextApiRequest,
  res: NextApiResponse,
  db: any,
  authUser: any
) {
  const { channelId } = req.query;
  const { name, description, isPrivate, permissions } = req.body;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  // Check if user is admin
  const user = await db.collection('users').findOne({
    _id: new ObjectId(authUser._id)
  });

  if (!user || (user.role !== 'admin' && user.roles?.role !== 'admin')) {
    return res.status(403).json({ error: 'Only admins can update channels' });
  }

  // Don't allow updating default channels (except description and permissions)
  const defaultChannelIds = ['general', 'projects', 'quotes'];
  const isDefault = defaultChannelIds.includes(channelId as string);

  if (isDefault && name) {
    return res.status(400).json({ error: 'Cannot rename default channels' });
  }

  // Find channel
  const channel = isDefault 
    ? { id: channelId, isDefault: true }
    : await db.collection('channels').findOne({
        _id: new ObjectId(channelId as string),
        deleted: { $ne: true }
      });

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  // Update channel
  const updates: any = {
    updatedAt: new Date()
  };

  if (name && !isDefault) {
    updates.name = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    updates.displayName = name;
  }
  if (description !== undefined) updates.description = description;
  if (isPrivate !== undefined) updates.isPrivate = isPrivate;
  if (permissions) updates.permissions = permissions;

  if (isDefault) {
    // For default channels, store settings separately
    await db.collection('channel_settings').updateOne(
      { 
        locationId: user.locationId,
        channelId: channelId as string
      },
      { 
        $set: {
          ...updates,
          locationId: user.locationId,
          channelId: channelId as string
        }
      },
      { upsert: true }
    );
  } else {
    await db.collection('channels').updateOne(
      { _id: new ObjectId(channelId as string) },
      { $set: updates }
    );
  }

  return res.status(200).json({ 
    channel: {
      ...channel,
      ...updates,
      id: channel._id?.toString() || channel.id
    }
  });
}

async function deleteChannel(
  req: NextApiRequest,
  res: NextApiResponse,
  db: any,
  authUser: any
) {
  const { channelId } = req.query;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  // Check if user is admin
  const user = await db.collection('users').findOne({
    _id: new ObjectId(authUser._id)
  });

  if (!user || (user.role !== 'admin' && user.roles?.role !== 'admin')) {
    return res.status(403).json({ error: 'Only admins can delete channels' });
  }

  // Don't allow deleting default channels
  const defaultChannelIds = ['general', 'projects', 'quotes'];
  if (defaultChannelIds.includes(channelId as string)) {
    return res.status(400).json({ error: 'Cannot delete default channels' });
  }

  // Find channel
  const channel = await db.collection('channels').findOne({
    _id: new ObjectId(channelId as string),
    deleted: { $ne: true }
  });

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  // Soft delete channel
  await db.collection('channels').updateOne(
    { _id: new ObjectId(channelId as string) },
    { 
      $set: { 
        deleted: true,
        deletedAt: new Date(),
        deletedBy: authUser.userId
      }
    }
  );

  // Remove all members
  await db.collection('channel_members').deleteMany({
    channelId: channelId as string
  });

  // Mark all messages as deleted (soft delete)
  await db.collection('team_messages').updateMany(
    { channelId: channelId as string },
    { $set: { channelDeleted: true } }
  );

  return res.status(200).json({ success: true });
}