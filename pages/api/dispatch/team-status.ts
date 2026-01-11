// pages/api/dispatch/team-status.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authUser = await verifyAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const locationId = req.query.locationId as string || authUser.locationId;

    // Connect to MongoDB
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get all users in the location
    const users = await db.collection('users').find({ 
      locationId,
      active: true 
    }).toArray();

    // Get active clock sessions
    const activeSessions = await db.collection('clock_sessions').find({
      locationId,
      status: 'active'
    }).toArray();

    // Get latest location updates for active sessions
    const sessionIds = activeSessions.map(s => s._id);
    const latestLocations = await db.collection('location_updates')
      .aggregate([
        {
          $match: {
            sessionId: { $in: sessionIds }
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $group: {
            _id: '$sessionId',
            latestLocation: { $first: '$$ROOT' }
          }
        }
      ])
      .toArray();

    // Create location map
    const locationMap = new Map();
    latestLocations.forEach(loc => {
      locationMap.set(loc._id.toString(), loc.latestLocation);
    });

    // Get current appointments/jobs for active users
    const activeUserIds = activeSessions.map(s => s.userId);
    const currentDate = new Date();
    const todayStart = new Date(currentDate.setHours(0, 0, 0, 0));
    const todayEnd = new Date(currentDate.setHours(23, 59, 59, 999));

    const currentJobs = await db.collection('appointments').find({
      assignedUserId: { $in: activeUserIds },
      start: { $gte: todayStart, $lte: todayEnd },
      status: 'scheduled'
    }).toArray();

    // Create job map
    const jobMap = new Map();
    currentJobs.forEach(job => {
      jobMap.set(job.assignedUserId, job);
    });

    // Build team status response
    const teamStatus = users.map(user => {
      const userSession = activeSessions.find(s => s.userId === user._id.toString());
      const latestLocation = userSession ? locationMap.get(userSession._id.toString()) : null;
      const currentJob = userSession ? jobMap.get(user._id.toString()) : null;

      return {
        userId: user._id,
        name: `${user.firstName} ${user.lastName}`,
        avatar: user.avatar,
        role: user.role,
        isClockedIn: !!userSession,
        clockedInAt: userSession?.clockInTime,
        lastUpdate: latestLocation?.timestamp || userSession?.updatedAt,
        currentActivity: latestLocation?.location?.activity?.type || 'unknown',
        currentSpeed: latestLocation?.location?.coords?.speed || 0,
        todaysMileage: userSession ? {
          total: userSession.totalMiles || 0,
          driving: userSession.drivingMiles || 0
        } : null,
        currentLocation: latestLocation?.location?.coords || null,
        currentJob: currentJob ? {
          id: currentJob._id,
          customerName: currentJob.contactName,
          address: currentJob.address,
          scheduledTime: currentJob.start
        } : null,
        onBreak: userSession?.onBreak || false,
        batteryLevel: latestLocation?.location?.batteryLevel
      };
    });

    // Sort by status (active first) then by name
    teamStatus.sort((a, b) => {
      if (a.isClockedIn && !b.isClockedIn) return -1;
      if (!a.isClockedIn && b.isClockedIn) return 1;
      return a.name.localeCompare(b.name);
    });

    return res.status(200).json(teamStatus);

  } catch (error: any) {
    console.error('Team status error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}