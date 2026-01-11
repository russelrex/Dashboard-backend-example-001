import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import cors from '@/lib/cors';

interface UserPermissions {
  scopes?: string[];
  scopesAssignedToOnly?: string[];
}

interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  emailChangeOTP?: string;
  password?: string;
  phone?: string;
  type?: string;
  role?: string;
  companyId?: string;
  locationIds?: string[];
  permissions?: UserPermissions;
  profilePhoto?: string;
}

interface UpdateUserResponse {
  success: boolean;
  data: any;
  userId: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { userId } = req.query;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid userId' });
  }

  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed. Use PUT.' });
  }

  try {
    const updateData: UpdateUserRequest = req.body;

    // Validate required fields if provided
    // Note: Email updates are deprecated and not supported

    console.log(`[GHL USER UPDATE] Updating user ${userId} with data:`, {
      ...updateData,
      password: updateData.password ? '***' : undefined
    });

    const ghlUrl = `https://services.leadconnectorhq.com/users/${userId}`;
    
    try {
      const ghlResponse = await axios.put(ghlUrl, updateData, {
        headers: {
          Authorization: `Bearer ${process.env.GHL_PRIVATE_KEY_USER_CREATE}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
          'Accept': 'application/json'
        }
      });

      console.log(`[GHL USER UPDATE] Successfully updated user ${userId}`);
      
      const response: UpdateUserResponse = {
        success: true,
        data: ghlResponse.data,
        userId
      };

      return res.status(200).json(response);

    } catch (ghlError: any) {
      console.error('[GHL USER UPDATE] GHL API Error:', ghlError.response?.data || ghlError.message);
      
      const status = ghlError.response?.status || 500;
      const errorMessage = ghlError.response?.data?.message || ghlError.response?.data || ghlError.message;
      
      return res.status(status).json({
        error: 'Failed to update user',
        details: errorMessage,
        ghlError: ghlError.response?.data
      });
    }

  } catch (error: any) {
    console.error('[GHL USER UPDATE] Unexpected error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}
