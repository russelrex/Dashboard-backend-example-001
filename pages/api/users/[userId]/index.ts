import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '../../../../src/lib/cors';

type UserStatus = 'active' | 'deleted' | 'restricted' | 'cancelled' | 'payment_failed';

interface UpdateUserRequest {
  name?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  avatar?: string;
  status?: UserStatus;
  restrictionReason?: string;
  invitedToApp?: boolean;
}

async function getUser(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = req.query as { userId: string };
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    let user;
    
    if (ObjectId.isValid(userId) && userId.length === 24) {
      user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.status === 'deleted') {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.status(200).json({
      success: true,
      data: user
    });
    
  } catch (error) {
    console.error('[Users] Error fetching user:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch user',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function updateUser(req: NextApiRequest, res: NextApiResponse) {
  const { userId } = req.query as { userId: string };
  
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const updateData = req.body as UpdateUserRequest;
    
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    let currentUser;
    
    if (ObjectId.isValid(userId) && userId.length === 24) {
      currentUser = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    }

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (currentUser.status === 'deleted' && updateData.status !== 'active') {
      return res.status(400).json({ error: 'Cannot modify deleted user except to reactivate' });
    }
    
    const previousStatus = currentUser.status || 'active';
    const newStatus = updateData.status;
    
    const update: any = {
      updatedAt: new Date().toISOString()
    };

    if (updateData.name) update.name = updateData.name;
    if (updateData.email) update.email = updateData.email;
    if (updateData.firstName) update.firstName = updateData.firstName;
    if (updateData.lastName) update.lastName = updateData.lastName;
    if (updateData.phone) update.phone = updateData.phone;
    if (updateData.avatar) update.avatar = updateData.avatar;
    if (updateData.invitedToApp !== undefined) update.invitedToApp = updateData.invitedToApp;

    if (newStatus && newStatus !== previousStatus) {
      update.status = newStatus;
      
      switch (newStatus) {
        case 'deleted':
          update.restrictedAt = new Date().toISOString();
          update.restrictionReason = updateData.restrictionReason || 'Account deleted by admin';
          update.isActive = false;
          break;
          
        case 'restricted':
          update.restrictedAt = new Date().toISOString();
          update.restrictionReason = updateData.restrictionReason || 'Account restricted by admin';
          update.isActive = false;
          break;
          
        case 'cancelled':
          update.restrictedAt = new Date().toISOString();
          update.restrictionReason = updateData.restrictionReason || 'Account cancelled';
          update.isActive = false;
          break;
          
        case 'payment_failed':
          update.restrictedAt = new Date().toISOString();
          update.restrictionReason = updateData.restrictionReason || 'Payment failed - account suspended';
          update.isActive = false;
          break;
          
        case 'active':
          if (currentUser.restrictedAt) {
            update.restrictedAt = null;
            update.restrictionReason = null;
          }
          update.isActive = true;
          break;
          
        default:
          return res.status(400).json({ error: 'Invalid status value' });
      }
    } else if (updateData.restrictionReason && (currentUser.status === 'restricted' || currentUser.status === 'cancelled' || currentUser.status === 'payment_failed')) {
      update.restrictionReason = updateData.restrictionReason;
    }
    
    const result = await db.collection('users').updateOne(
      { _id: currentUser._id },
      { $set: update }
    );
    
    if (!result.modifiedCount && !result.matchedCount) {
      return res.status(500).json({ error: 'Failed to update user' });
    }

    if (newStatus && newStatus !== previousStatus) {
      try {
        await db.collection('audit_logs').insertOne({
          action: 'user_status_changed',
          userId: currentUser._id,
          userEmail: currentUser.email,
          timestamp: new Date().toISOString(),
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
          details: {
            previousStatus,
            newStatus,
            restrictionReason: update.restrictionReason,
            changedBy: 'admin'
          }
        });
      } catch (auditError) {
        console.error('[Users] Failed to create audit log:', auditError);
      }
    }
    
    const updatedUser = await db.collection('users').findOne({ _id: currentUser._id });
    
    return res.status(200).json({
      success: true,
      data: updatedUser,
      message: getStatusChangeMessage(previousStatus, newStatus)
    });
    
  } catch (error) {
    console.error('[Users] Error updating user:', error);
    return res.status(500).json({ 
      error: 'Failed to update user',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

function getStatusChangeMessage(previousStatus: string, newStatus?: string): string {
  if (!newStatus || newStatus === previousStatus) {
    return 'User updated successfully';
  }
  
  switch (newStatus) {
    case 'active':
      return `User account activated${previousStatus !== 'active' ? ' (restrictions removed)' : ''}`;
    case 'deleted':
      return 'User account deleted';
    case 'restricted':
      return 'User account restricted';
    case 'cancelled':
      return 'User account cancelled';
    case 'payment_failed':
      return 'User account suspended due to payment failure';
    default:
      return 'User updated successfully';
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  switch (req.method) {
    case 'GET':
      return getUser(req, res);
    case 'PATCH':
      return updateUser(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}
