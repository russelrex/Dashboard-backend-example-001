import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '../../../src/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    const client = await clientPromise();
    const db = client.db(getDbName());

    // Find user by reset token
    const user = await db.collection('users').findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: new Date() },
      isDeleted: { $ne: true }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user password and clear reset token
    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: {
          hashedPassword,
          updatedAt: new Date()
        },
        $unset: {
          resetToken: '',
          resetTokenExpiry: ''
        }
      }
    );

    // Generate JWT for auto-login
    const jwtToken = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        locationId: user.locationId || user.locations?.[0]?.locationId,
        role: user.role || user.locations?.[0]?.role
      },
      process.env.JWT_SECRET!,
      { expiresIn: '30d' }
    );

    console.log(`[Password Reset] Password successfully reset for ${user.email}`);

    return res.status(200).json({
      success: true,
      token: jwtToken,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name || user.firstName,
        role: user.role || user.locations?.[0]?.role,
        locationId: user.locationId || user.locations?.[0]?.locationId
      }
    });

  } catch (error: any) {
    console.error('[Password Reset] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to reset password',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
