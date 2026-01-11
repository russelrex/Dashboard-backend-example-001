// lpai-backend/pages/api/login.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../src/lib/mongodb';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { ensureUserPreferences } from '../../src/utils/userPreferences';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is missing or too weak. Set it in .env.local');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Missing email or password' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const user = await db.collection('users').findOne({ 
      email: { $regex: new RegExp(`^${email}$`, 'i') } 
    });

    if (!user || !user.hashedPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.hashedPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Ensure user has complete preferences with defaults
    user.preferences = ensureUserPreferences(user.preferences);

    // ✅ Fetch the location's business name (not "LeadProspecting.AI")
    const location = await db.collection('locations').findOne({ 
      locationId: user.locationId 
    });

    // CRITICAL: Prefer business.name over name field (name field contains "LeadProspecting.AI")
    const locationName = location?.business?.name || location?.name || 'Your Company';

    // Update user's lastLogin
    await db.collection('users').updateOne(
      { _id: user._id },
      { 
        $set: { 
          lastLogin: new Date().toISOString(),
          // Also save the merged preferences back to DB
          preferences: user.preferences
        } 
      }
    );

    // Payload for JWT
    const payload = {
      userId: user.ghlUserId || user.userId,
      locationId: user.locationId,
      name: user.name,
      permissions: user.permissions || [],
      role: user.role || 'user',
      type: user.type || 'agency',
      _id: user._id,
      email: user.email,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    // Log token creation details for debugging iOS clock issues
    const decodedToken = jwt.decode(token) as any;
    const now = Math.floor(Date.now() / 1000);
    const expiry = decodedToken?.exp || 0;
    console.log('🔐 [LOGIN] Token created:', {
      userId: user._id,
      email: user.email,
      now,
      nowDate: new Date(now * 1000).toISOString(),
      expiry,
      expiryDate: new Date(expiry * 1000).toISOString(),
      timeUntilExpiry: expiry - now,
      timeUntilExpiryMinutes: Math.floor((expiry - now) / 60),
      timeUntilExpiryDays: Math.floor((expiry - now) / 86400),
    });

    // Full user object returned to frontend (including complete preferences!)
    const loginResponse = {
      token,
      userId: user.ghlUserId || user.userId,        // Keep for backward compatibility
      ghlUserId: user.ghlUserId || user.userId,     // ADD THIS - AuthContext expects this field
      locationId: user.locationId,
      locationName: locationName,  // ✅ ADD THIS!
      name: user.name,
      permissions: user.permissions || [],
      role: user.role || 'user',
      type: user.type || 'agency',
      _id: user._id.toString(),
      email: user.email,
      preferences: user.preferences, // Now includes all defaults
      // Include other user fields
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      phone: user.phone || '',
      avatar: user.avatar || '',
      isActive: user.isActive !== false, // Default to true
      extension: user.extension || '',
      roles: user.roles || {
        type: 'account',
        role: user.role || 'user',
        locationIds: [user.locationId]
      },
      // Navigation (legacy - moving to preferences)
      navigatorOrder: user.navigatorOrder || user.preferences.navigatorOrder,
      // Metadata
      dateAdded: user.dateAdded || user.createdAt || null,
      lastSyncedAt: user.lastSyncedAt || null,
      createdAt: user.createdAt || null,
      updatedAt: user.updatedAt || new Date().toISOString(),
    };

    // Debug log
    console.log('[LOGIN SUCCESS]', {
      email: user.email,
      name: user.name,
      hasPreferences: !!user.preferences,
      timezone: user.preferences?.timezone,
      communicationProvider: user.preferences?.communication?.phoneProvider,
    });

    return res.status(200).json(loginResponse);

  } catch (error) {
    console.error('[LOGIN ERROR]', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}