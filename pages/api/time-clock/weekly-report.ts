// pages/api/time-clock/weekly-report.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { startOfWeek, endOfWeek, eachDayOfInterval, format } from 'date-fns';

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

    const { userId, weekStart, locationId } = req.query;
    
    // Use provided week start or current week
    const weekStartDate = weekStart 
      ? new Date(weekStart as string)
      : startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday start
    
    const weekEndDate = endOfWeek(weekStartDate, { weekStartsOn: 1 });

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Build query
    const query: any = {
      clockInTime: {
        $gte: weekStartDate,
        $lte: weekEndDate
      }
    };

    // If specific user requested
    if (userId && userId !== 'all') {
      query.userId = userId as string;
    }

    // If location specified
    if (locationId) {
      query.locationId = locationId as string;
    } else if (authUser.locationId) {
      query.locationId = authUser.locationId;
    }

    // ✅ FAST: Use MongoDB aggregation to calculate everything on database side
    const pipeline = [
      // Match sessions in date range and location
      {
        $match: query
      },
      // Group by user and day
      {
        $group: {
          _id: {
            userId: '$userId',
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$clockInTime'
              }
            }
          },
          totalHours: {
            $sum: {
              $cond: [
                { $ne: ['$clockOutTime', null] },
                { $ifNull: ['$workHours', { $divide: [{ $subtract: ['$clockOutTime', '$clockInTime'] }, 3600000] }] },
                0
              ]
            }
          },
          totalMiles: { $sum: { $ifNull: ['$totalMiles', 0] } },
          drivingMiles: { $sum: { $ifNull: ['$drivingMiles', 0] } },
          breakMinutes: { $sum: { $divide: [{ $ifNull: ['$breakDurationMs', 0] }, 60000] } },
          sessions: {
            $push: {
              id: '$_id',
              clockIn: '$clockInTime',
              clockOut: '$clockOutTime',
              hours: {
                $cond: [
                  { $ne: ['$clockOutTime', null] },
                  { $ifNull: ['$workHours', { $divide: [{ $subtract: ['$clockOutTime', '$clockInTime'] }, 3600000] }] },
                  0
                ]
              },
              miles: { $ifNull: ['$totalMiles', 0] },
              breaks: { $ifNull: ['$breaks', []] },
              status: '$status'
            }
          }
        }
      },
      // Group by user to get weekly totals
      {
        $group: {
          _id: '$_id.userId',
          dailyBreakdown: {
            $push: {
              date: '$_id.date',
              totalHours: '$totalHours',
              totalMiles: '$totalMiles',
              drivingMiles: '$drivingMiles',
              breakMinutes: '$breakMinutes',
              sessions: '$sessions'
            }
          },
          weekTotalHours: { $sum: '$totalHours' },
          weekTotalMiles: { $sum: '$totalMiles' },
          weekDrivingMiles: { $sum: '$drivingMiles' },
          weekBreakMinutes: { $sum: '$breakMinutes' },
          hasActiveSession: {
            $max: {
              $cond: [
                { $anyElementTrue: { $map: { input: '$sessions', as: 's', in: { $eq: ['$$s.status', 'active'] } } } },
                true,
                false
              ]
            }
          }
        }
      }
    ];

    const aggregatedData = await db.collection('clock_sessions')
      .aggregate(pipeline)
      .toArray();

    // Get user details (still need this for names/rates)
    const userIds = aggregatedData.map(d => d._id);
    const users = await db.collection('users')
      .find({ ghlUserId: { $in: userIds } })
      .toArray();

    const userMap = new Map();
    users.forEach(user => {
      userMap.set(user.ghlUserId, user);
    });

    // Get labor rules
    const laborRules = await db.collection('labor_rules').findOne({
      locationId: query.locationId,
      effectiveDate: { $lte: weekEndDate },
      $or: [
        { expiryDate: { $gte: weekStartDate } },
        { expiryDate: null }
      ]
    });

    const overtimeThreshold = laborRules?.rules?.overtime?.weeklyThreshold || 40;
    const overtimeMultiplier = laborRules?.rules?.overtime?.multiplier || 1.5;
    const dailyOvertimeThreshold = laborRules?.rules?.overtime?.dailyThreshold;

    // Build days of week for complete daily breakdown
    const daysOfWeek = eachDayOfInterval({
      start: weekStartDate,
      end: weekEndDate
    });

    // Format the aggregated data
    const reportData = aggregatedData.map(userData => {
      const userId = userData._id;
      const user = userMap.get(userId);
      
      // Create a map of dates to daily data
      const dailyMap = new Map();
      userData.dailyBreakdown.forEach((day: any) => {
        dailyMap.set(day.date, day);
      });

      // Build complete daily breakdown with all days (including zeros)
      const dailyBreakdown = daysOfWeek.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayData = dailyMap.get(dateStr) || {
          totalHours: 0,
          totalMiles: 0,
          drivingMiles: 0,
          breakMinutes: 0,
          sessions: []
        };

        // Calculate daily overtime if applicable
        let regularHours = dayData.totalHours;
        let overtimeHours = 0;
        if (dailyOvertimeThreshold && dayData.totalHours > dailyOvertimeThreshold) {
          regularHours = dailyOvertimeThreshold;
          overtimeHours = dayData.totalHours - dailyOvertimeThreshold;
        }

        return {
          date: dateStr,
          dayName: format(day, 'EEEE'),
          totalHours: dayData.totalHours,
          totalMiles: dayData.totalMiles,
          drivingMiles: dayData.drivingMiles,
          breakMinutes: dayData.breakMinutes,
          regularHours,
          overtimeHours,
          formattedHours: formatDuration(dayData.totalHours * 60 * 60 * 1000),
          sessions: dayData.sessions
        };
      });

      // Calculate weekly overtime
      let regularHours = userData.weekTotalHours;
      let overtimeHours = 0;
      
      if (!dailyOvertimeThreshold && userData.weekTotalHours > overtimeThreshold) {
        regularHours = overtimeThreshold;
        overtimeHours = userData.weekTotalHours - overtimeThreshold;
      } else if (dailyOvertimeThreshold) {
        regularHours = dailyBreakdown.reduce((sum, day) => sum + day.regularHours, 0);
        overtimeHours = dailyBreakdown.reduce((sum, day) => sum + day.overtimeHours, 0);
      }

      const hourlyRate = user?.hourlyRate || 0;
      const estimatedPay = (regularHours * hourlyRate) + (overtimeHours * hourlyRate * overtimeMultiplier);

      // Find active session info
      const activeSession = userData.dailyBreakdown
        .flatMap((d: any) => d.sessions)
        .find((s: any) => s.status === 'active');

      return {
        userId,
        userName: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
        email: user?.email,
        role: user?.role,
        hourlyRate,
        weekTotal: {
          hours: userData.weekTotalHours,
          formattedHours: formatDuration(userData.weekTotalHours * 60 * 60 * 1000),
          miles: userData.weekTotalMiles,
          drivingMiles: userData.weekDrivingMiles,
          regularHours,
          overtimeHours,
          breakMinutes: userData.weekBreakMinutes,
          estimatedPay
        },
        dailyBreakdown,
        hasActiveSession: userData.hasActiveSession,
        activeSessionStart: activeSession?.clockIn
      };
    });

    // Calculate location totals
    const locationTotals = {
      totalHours: reportData.reduce((sum, user) => sum + user.weekTotal.hours, 0),
      totalMiles: reportData.reduce((sum, user) => sum + user.weekTotal.miles, 0),
      totalEstimatedPay: reportData.reduce((sum, user) => sum + user.weekTotal.estimatedPay, 0),
      activeUsers: reportData.filter(u => u.hasActiveSession).length,
      totalUsers: reportData.length
    };

    return res.status(200).json({
      weekStart: weekStartDate,
      weekEnd: weekEndDate,
      locationId: query.locationId,
      users: reportData,
      totals: locationTotals,
      laborRules: {
        overtimeThreshold,
        overtimeMultiplier,
        dailyOvertimeThreshold,
        source: laborRules?.ruleName || 'Default'
      },
      generated: new Date()
    });

  } catch (error: any) {
    console.error('Weekly report error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}