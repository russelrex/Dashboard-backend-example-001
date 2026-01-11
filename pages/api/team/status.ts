// pages/api/team/status.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import jwt from 'jsonwebtoken';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const { locationId } = req.query;
    
    const client = await clientPromise;
    const db = client.db(getDbName());

    console.log('📍 [Team Status] Fetching team for location:', locationId);

    // Get all team members with their clock-in status
    const teamMembers = await db.collection('users')
      .find({ 
        locationId: locationId as string,
        deleted: { $ne: true }
      })
      .project({
        _id: 1,
        ghlUserId: 1, // ✅ ADD THIS - fetch GHL user ID from database
        name: 1,
        email: 1,
        phone: 1,
        role: 1,
        lastLocation: 1,
        lastActivity: 1,
        status: 1,
        currentClockStatus: 1,  // ✅ FIXED: Get the entire currentClockStatus object
        currentMiles: 1,
      })
      .toArray();

    console.log(`📦 [Team Status] Found ${teamMembers.length} total members`);

    // Calculate online status based on currentClockStatus
    const enrichedMembers = teamMembers.map(member => {
      // ✅ FIXED: Check currentClockStatus.isClockedIn instead of member.isClockedIn
      const isClockedIn = member.currentClockStatus?.isClockedIn || false;
      const clockInTime = member.currentClockStatus?.clockInTime || null; // ✅ ADD THIS
      
      const isOnline = isClockedIn || 
        (member.lastActivity && 
         new Date().getTime() - new Date(member.lastActivity).getTime() < 5 * 60 * 1000);

      console.log(`👤 [Team Status] ${member.name}: clockedIn=${isClockedIn}, hasLocation=${!!member.lastLocation}, clockInTime=${clockInTime}`);

      return {
        userId: member._id.toString(),
        ghlUserId: member.ghlUserId, // ✅ ADD THIS - for Ably subscriptions
        name: member.name,
        email: member.email,
        phone: member.phone,
        role: member.role,
        status: isOnline ? 'online' : 'offline',
        isClockedIn: isClockedIn,
        clockInTime: clockInTime, // ✅ ADD THIS
        lastLocation: member.lastLocation,
        currentMiles: member.currentMiles,
        lastSeen: member.lastActivity,
      };
    });

    const clockedInCount = enrichedMembers.filter(m => m.isClockedIn).length;
    console.log(`✅ [Team Status] Returning ${clockedInCount} clocked in / ${enrichedMembers.length} total`);

    return res.status(200).json({ teamMembers: enrichedMembers });
  } catch (error: any) {
    console.error('❌ [Team Status] Error:', error);
    return res.status(500).json({ error: 'Failed to get team status' });
  }
}
