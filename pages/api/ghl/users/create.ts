import type { NextApiRequest, NextApiResponse } from 'next';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError } from '../../../../src/utils/httpResponses';
import { sendMethodNotAllowed } from '@/utils/response';
import axios from 'axios';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { randomBytes } from 'crypto';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res, ['POST']);
  }

  return await createGHLUser(req, res);
}

async function createGHLUser(req: NextApiRequest, res: NextApiResponse) {
  try {
    const userData: CreateUserRequest = req.body;

    const requestPayload: any = {
      companyId: userData.companyId,
      firstName: userData.firstName,
      lastName: userData.lastName || 'default',
      email: userData.email,
      password: userData.password,
      phone: userData.phone,
      type: userData.type,
      role: userData.role,
      locationIds: userData.locationIds || [],
      permissions: userData.permissions || {},
      profilePhoto: userData.profilePhoto
    };

    if (userData.scopes && userData.scopes.length > 0) {
      requestPayload.scopes = userData.scopes;
    }
    if (userData.scopesAssignedToOnly && userData.scopesAssignedToOnly.length > 0) {
      requestPayload.scopesAssignedToOnly = userData.scopesAssignedToOnly;
    }

    const response = await axios.post(
      'https://services.leadconnectorhq.com/users/',
      requestPayload,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_PRIVATE_KEY_USER_CREATE}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json'
        }
      }
    );

    const ghlUser = response.data;

    const client = await clientPromise;
    const db = client.db(getDbName());

    const defaultPermissions = {
      adwordsReportingEnabled: userData.permissions?.adwordsReportingEnabled ?? true,
      affiliateManagerEnabled: userData.permissions?.affiliateManagerEnabled ?? true,
      agentReportingEnabled: userData.permissions?.agentReportingEnabled ?? true,
      appointmentsEnabled: userData.permissions?.appointmentsEnabled ?? true,
      assignedDataOnly: userData.permissions?.assignedDataOnly ?? false,
      attributionsReportingEnabled: userData.permissions?.attributionsReportingEnabled ?? true,
      botService: userData.permissions?.botService ?? true,
      bulkRequestsEnabled: userData.permissions?.bulkRequestsEnabled ?? true,
      campaignsEnabled: userData.permissions?.campaignsEnabled ?? true,
      campaignsReadOnly: userData.permissions?.campaignsReadOnly ?? false,
      cancelSubscriptionEnabled: userData.permissions?.cancelSubscriptionEnabled ?? true,
      communitiesEnabled: userData.permissions?.communitiesEnabled ?? true,
      contactsEnabled: userData.permissions?.contactsEnabled ?? true,
      contentAiEnabled: userData.permissions?.contentAiEnabled ?? true,
      conversationsEnabled: userData.permissions?.conversationsEnabled ?? true,
      dashboardStatsEnabled: userData.permissions?.dashboardStatsEnabled ?? true,
      exportPaymentsEnabled: userData.permissions?.exportPaymentsEnabled ?? true,
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
      workflowsReadOnly: userData.permissions?.workflowsReadOnly ?? false
    };

    const setupToken = randomBytes(32).toString('hex');
    const setupTokenExpiry = new Date();
    setupTokenExpiry.setDate(setupTokenExpiry.getDate() + 7);

    const primaryLocationId = userData.locationIds && userData.locationIds.length > 0 
      ? userData.locationIds[0] 
      : userData.companyId;

    const localUser = {
      ghlUserId: ghlUser.id,
      userId: ghlUser.id,
      locationId: primaryLocationId,
      companyId: userData.companyId,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      type: userData.type,
      role: userData.role,
      permissions: defaultPermissions,
      phone: userData.phone || '',
      avatar: userData.profilePhoto || '',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLogin: new Date(),
      timezone: 'America/Los_Angeles',
      language: 'en',
      processedBy: "ghl-api",
      setupToken: setupToken,
      setupTokenExpiry: setupTokenExpiry,
      needsSetup: true,
      ghlData: {
        locationIds: userData.locationIds || [],
        scopes: userData.scopes || [],
        scopesAssignedToOnly: userData.scopesAssignedToOnly || []
      }
    };

    const localResult = await db.collection('users').insertOne(localUser);

    return sendSuccess(res, {
      ghlUser,
      localUser: {
        userId: localResult.insertedId,
        email: localUser.email,
        setupToken: setupToken,
        setupTokenExpiry: setupTokenExpiry
      },
      message: 'User created successfully in GoHighLevel and local database'
    });

  } catch (error: any) {
    if (error.response?.data) {
      const ghlError = error.response.data;
      return sendServerError(res, `GHL API Error: ${ghlError.message || error.message}`, error.response.status || 500);
    }

    if (error.code === 'ECONNREFUSED') {
      return sendServerError(res, 'Unable to connect to GHL API', 'Connection refused');
    }

    if (error.response?.status === 400) {
      return sendBadRequest(res, 'Invalid request data');
    }

    if (error.response?.status === 401) {
      return sendServerError(res, 'Authentication failed with GHL API');
    }

    return sendServerError(res, 'Failed to create user', error.message);
  }
}


interface CreateUserRequest {
    companyId: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    phone?: string;
    type: 'account' | 'agency';
    role: 'admin' | 'user';
    locationIds?: string[];
    permissions?: {
      campaignsEnabled?: boolean;
      campaignsReadOnly?: boolean;
      contactsEnabled?: boolean;
      workflowsEnabled?: boolean;
      workflowsReadOnly?: boolean;
      triggersEnabled?: boolean;
      funnelsEnabled?: boolean;
      websitesEnabled?: boolean;
      opportunitiesEnabled?: boolean;
      dashboardStatsEnabled?: boolean;
      bulkRequestsEnabled?: boolean;
      appointmentsEnabled?: boolean;
      reviewsEnabled?: boolean;
      onlineListingsEnabled?: boolean;
      phoneCallEnabled?: boolean;
      conversationsEnabled?: boolean;
      assignedDataOnly?: boolean;
      adwordsReportingEnabled?: boolean;
      membershipEnabled?: boolean;
      facebookAdsReportingEnabled?: boolean;
      attributionsReportingEnabled?: boolean;
      settingsEnabled?: boolean;
      tagsEnabled?: boolean;
      leadValueEnabled?: boolean;
      marketingEnabled?: boolean;
      agentReportingEnabled?: boolean;
      botService?: boolean;
      socialPlanner?: boolean;
      bloggingEnabled?: boolean;
      invoiceEnabled?: boolean;
      affiliateManagerEnabled?: boolean;
      contentAiEnabled?: boolean;
      refundsEnabled?: boolean;
      recordPaymentEnabled?: boolean;
      cancelSubscriptionEnabled?: boolean;
      paymentsEnabled?: boolean;
      communitiesEnabled?: boolean;
      exportPaymentsEnabled?: boolean;
    };
    scopes?: string[];
    scopesAssignedToOnly?: string[];
    profilePhoto?: string;
  }