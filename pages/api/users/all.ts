// pages/api/users/all.ts
// API endpoint to fetch all users with pagination and filtering
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendPaginated, sendServerError } from '../../../src/utils/httpResponses';

interface UsersQuery {
  page?: string;
  limit?: string;
  search?: string;
  locationId?: string;
  role?: string;
  type?: string;
  isActive?: string;
  isTest?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    return await getAllUsers(req, res);
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getAllUsers(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const {
      page = '1',
      limit = '50',
      search = '',
      locationId = '',
      role = '',
      type = '',
      isActive = '',
      isTest = ''
    }: UsersQuery = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50)); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    filter.$and = [
      { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] },
      { $or: [{ isDeleted: { $exists: false } }, { isDeleted: false }] }
    ];

    if (search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      filter.$or = [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }

    if (locationId.trim()) {
      filter.locationId = locationId.trim();
    }

    if (role.trim()) {
      filter.role = role.trim();
    }

    if (type.trim()) {
      filter.type = type.trim();
    }

    if (isActive === 'true') {
      filter.isActive = true;
    } else if (isActive === 'false') {
      filter.isActive = false;
    }

    if (isTest === 'true') {
      filter.isTest = true;
    } else if (isTest === 'false') {
      filter.$or = [
        { isTest: { $exists: false } },
        { isTest: false }
      ];
    }

    const totalCount = await db.collection('users').countDocuments(filter);
    
    const users = await db.collection('users')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .project({
        // Only exclude sensitive fields - all other fields will be included by default
        hashedPassword: 0,
        setupToken: 0,
        ghlOAuth: 0,
        apiKey: 0
      })
      .toArray();

    const formattedUsers = users.map(user => ({
      _id: user._id,
      locationId: user.locationId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName || '',
      name: user.name || `${user.firstName} ${user.lastName || ''}`.trim(),
      type: user.type,
      role: user.role,
      permissions: user.permissions || {},
      phone: user.phone || '',
      avatar: user.avatar || '',
      isActive: user.isActive !== false, // Default to true if not set
      // Status fields
      status: user.status || 'active',
      restrictionReason: user.restrictionReason || null,
      restrictedAt: user.restrictedAt || null,
      cancelledAt: user.cancelledAt || null,
      paymentFailedAt: user.paymentFailedAt || null,
      // Timestamps
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin,
      timezone: user.timezone,
      language: user.language || 'en',
      isTest: user.isTest || false,
      processedBy: user.processedBy,
      needsSetup: user.needsSetup || false,
      setupTokenExpiry: user.setupTokenExpiry
    }));

    const responseData = {
      users: formattedUsers,
      filters: {
        search: search || null,
        locationId: locationId || null,
        role: role || null,
        type: type || null,
        isActive: isActive || null,
        isTest: isTest || null
      }
    };

    return sendPaginated(
      res,
      responseData.users,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Users retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching users:', error);
    return sendServerError(res, error, 'Failed to fetch users');
  }
} 