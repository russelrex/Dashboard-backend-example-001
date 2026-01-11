// pages/api/dispatch/stats.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
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

    // Get today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Get active technicians count
    const activeTechnicians = await db.collection('clock_sessions').countDocuments({
      locationId,
      status: 'active'
    });

    // Get today's total mileage
    const todaysMileage = await db.collection('clock_sessions').aggregate([
      {
        $match: {
          locationId,
          clockInTime: { $gte: todayStart, $lte: todayEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalMiles: { $sum: '$totalMiles' },
          drivingMiles: { $sum: '$drivingMiles' }
        }
      }
    ]).toArray();

    const mileageData = todaysMileage[0] || { totalMiles: 0, drivingMiles: 0 };

    // Get productivity stats
    const productivityStats = await db.collection('clock_sessions').aggregate([
      {
        $match: {
          locationId,
          clockInTime: { $gte: todayStart, $lte: todayEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          completedSessions: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          avgSessionDuration: {
            $avg: {
              $cond: [
                { $eq: ['$status', 'completed'] },
                { $subtract: ['$clockOutTime', '$clockInTime'] },
                null
              ]
            }
          }
        }
      }
    ]).toArray();

    const productivity = productivityStats[0] || {
      totalSessions: 0,
      completedSessions: 0,
      avgSessionDuration: 0
    };

    return res.status(200).json({
      activeTechnicians,
      totalMilesToday: mileageData.totalMiles,
      drivingMilesToday: mileageData.drivingMiles,
      productivity: {
        totalSessions: productivity.totalSessions,
        completedSessions: productivity.completedSessions,
        avgSessionDuration: productivity.avgSessionDuration
          ? Math.round(productivity.avgSessionDuration / (1000 * 60)) // Convert to minutes
          : 0
      },
      timestamp: new Date()
    });

  } catch (error: any) {
    console.error('Dispatch stats error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}