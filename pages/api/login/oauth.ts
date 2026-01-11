// pages/api/login.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import jwt from 'jsonwebtoken';
import { sendSuccess } from '../../../src/utils/httpResponses';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is missing or too weak. Set it in .env.local');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const email = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Missing email from Google' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const user = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${email}$`, 'i') } 
    });

    if (!user) {
        return sendSuccess(res, {email}, 'No Email Found', { noEmailFound: true });
    }

    const payload = {
      userId: user.ghlUserId,
      locationId: user.locationId,
      name: user.name,
      permissions: user.permissions || [],
      role: user.role || 'user',
      _id: user._id,
      email: user.email,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    const loginResponse = {
      token,
      userId: user.ghlUserId,        // Keep for backward compatibility
      ghlUserId: user.ghlUserId,     // ADD THIS - AuthContext expects this field
      locationId: user.locationId,
      name: user.name,
      permissions: user.permissions || [],
      role: user.role || 'user',
      _id: user._id,
      email: user.email,
      preferences: user.preferences || {},
      // Include other user fields that AuthContext might expect
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      phone: user.phone || '',
      avatar: user.avatar || '',
      isActive: user.isActive !== false, // Default to true
      locationIds: user.locationIds || [user.locationId], // For multi-location support
    };

    return sendSuccess(res, loginResponse, 'Logged in successfully');

  } catch (error) {
    console.error('[LOGIN ERROR]', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}