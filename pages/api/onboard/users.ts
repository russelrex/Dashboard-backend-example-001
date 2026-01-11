import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendConflict } from '../../../src/utils/httpResponses';
import { randomBytes } from 'crypto';

interface DynamicCreateUserRequest {
  locationId: string;
  email: string;
  firstName: string;
  type: string;
  lastName?: string;
  role?: string;
  permissions?: any;
  phone?: string;
  avatar?: string;
  isActive?: boolean;
  timezone?: string;
  language?: string;
  needsSetup?: boolean;
  businessName?: string;
  [key: string]: any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'POST':
      return await createUser(req, res);
    case 'GET':
      return await getUsers(req, res);
    case 'DELETE':
      return await deleteUser(req, res);
    default:
      res.setHeader('Allow', ['POST', 'GET', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function createUser(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const userData: DynamicCreateUserRequest = req.body;

    if (!userData.locationId || !userData.email || !userData.firstName || !userData.type) {
      return sendBadRequest(res, 'Missing required fields: locationId, email, firstName, type are required');
    }

    const existingUser = await db.collection('users').findOne({ 
      email: userData.email,
      locationId: userData.locationId 
    });

    if (existingUser) {
      return sendConflict(res, 'User with this email already exists for this location');
    }

    const defaultPermissions = {
      adwordsReportingEnabled: userData.permissions?.adwordsReportingEnabled ?? true,
      affiliateManagerEnabled: userData.permissions?.affiliateManagerEnabled ?? true,
      agencyViewEnabled: userData.permissions?.agencyViewEnabled ?? true,
      appointmentsEnabled: userData.permissions?.appointmentsEnabled ?? true,
      assignedDataOnly: userData.permissions?.assignedDataOnly ?? false,
      attributionsReportingEnabled: userData.permissions?.attributionsReportingEnabled ?? true,
      bulkRequestsEnabled: userData.permissions?.bulkRequestsEnabled ?? true,
      campaignsEnabled: userData.permissions?.campaignsEnabled ?? true,
      campaignsReadOnly: userData.permissions?.campaignsReadOnly ?? false,
      cancelSubscriptionEnabled: userData.permissions?.cancelSubscriptionEnabled ?? true,
      communitiesEnabled: userData.permissions?.communitiesEnabled ?? true,
      contactsEnabled: userData.permissions?.contactsEnabled ?? true,
      conversationsEnabled: userData.permissions?.conversationsEnabled ?? true,
      dashboardStatsEnabled: userData.permissions?.dashboardStatsEnabled ?? true,
      facebookAdsReportingEnabled: userData.permissions?.facebookAdsReportingEnabled ?? true,
      funnelsEnabled: userData.permissions?.funnelsEnabled ?? true,
      invoiceEnabled: userData.permissions?.invoiceEnabled ?? true,
      leadValueEnabled: userData.permissions?.leadValueEnabled ?? true,
      marketingEnabled: userData.permissions?.marketingEnabled ?? true,
      membershipEnabled: userData.permissions?.membershipEnabled ?? true,
      onlineListingsEnabled: userData.permissions?.onlineListingsEnabled ?? true,
      opportunitiesEnabled: userData.permissions?.opportunitiesEnabled ?? true,
      paymentsEnabled: userData.permissions?.paymentsEnabled ?? true,
      phoneCallEnabled: userData.permissions?.phoneCallEnabled ?? true,
      recordPaymentEnabled: userData.permissions?.recordPaymentEnabled ?? true,
      refundsEnabled: userData.permissions?.refundsEnabled ?? true,
      reviewsEnabled: userData.permissions?.reviewsEnabled ?? true,
      settingsEnabled: userData.permissions?.settingsEnabled ?? true,
      socialPlanner: userData.permissions?.socialPlanner ?? true,
      tagsEnabled: userData.permissions?.tagsEnabled ?? true,
      triggersEnabled: userData.permissions?.triggersEnabled ?? true,
      websitesEnabled: userData.permissions?.websitesEnabled ?? true,
      workflowsEnabled: userData.permissions?.workflowsEnabled ?? true,
      bloggingEnabled: userData.permissions?.bloggingEnabled ?? true,
      contentAiEnabled: userData.permissions?.contentAiEnabled ?? true
    };

    const setupToken = randomBytes(32).toString('hex');
    const setupTokenExpiry = new Date();
    setupTokenExpiry.setDate(setupTokenExpiry.getDate() + 7);

    const newUser = {
      locationId: userData.locationId,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName || '',
      type: userData.type,
      role: userData.role,
      permissions: userData.permissions || defaultPermissions,
      phone: userData.phone || '',
      avatar: userData.avatar || '',
      isActive: userData.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: new Date(),
      timezone: userData.timezone || 'America/Los_Angeles',
      language: userData.language || 'en',
      processedBy: "onboard-api",
      setupToken: setupToken,
      setupTokenExpiry: setupTokenExpiry,
      needsSetup: userData.needsSetup ?? true,
      businessName: userData.businessName || '',
      ...Object.fromEntries(
        Object.entries(userData).filter(([key]) => 
          !['locationId', 'email', 'firstName', 'lastName', 'type', 'role', 'permissions', 
            'phone', 'avatar', 'isActive', 'timezone', 'language', 'needsSetup', 'businessName'].includes(key)
        )
      )
    };

    const result = await db.collection('users').insertOne(newUser);

    return sendSuccess(res, {
      userId: result.insertedId,
      email: newUser.email,
      setupToken: setupToken,
      setupTokenExpiry: setupTokenExpiry,
      data: newUser
    }, 'User created successfully');

  } catch (error) {
    console.error('Error creating user:', error);
    return sendServerError(res, 'Failed to create user');
  }
}

async function getUsers(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { locationId, email, type, role, isActive, limit = '50', page = '1' } = req.query;
    
    let query: any = {};
    if (locationId) query.locationId = locationId;
    if (email) query.email = email;
    if (type) query.type = type;
    if (role) query.role = role;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const users = await db.collection('users')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const total = await db.collection('users').countDocuments(query);

    return sendSuccess(res, {
      users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    }, 'Users retrieved successfully');

  } catch (error) {
    console.error('Error fetching users:', error);
    return sendServerError(res, 'Failed to fetch users');
  }
}

async function deleteUser(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const { userId, email, locationId } = req.query;

    if (!userId && !email) {
      return sendBadRequest(res, 'Either userId or email is required');
    }

    let query: any = {};
    if (userId) {
      const { ObjectId } = require('mongodb');
      query._id = new ObjectId(userId as string);
    } else if (email) {
      query.email = email;
      if (locationId) query.locationId = locationId;
    }

    const result = await db.collection('users').deleteOne(query);

    if (result.deletedCount === 0) {
      return sendBadRequest(res, 'User not found');
    }

    return sendSuccess(res, null, 'User deleted successfully');

  } catch (error) {
    console.error('Error deleting user:', error);
    return sendServerError(res, 'Failed to delete user');
  }
} 