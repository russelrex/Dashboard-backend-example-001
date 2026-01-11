// pages/api/time-clock/live-status.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { startOfWeek, startOfDay } from 'date-fns';

// Simple in-memory cache for live status (10 second TTL)
const liveStatusCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 10000; // 10 seconds

// Auth middleware - returns null instead of throwing to prevent spam
async function verifyAuth(req: NextApiRequest) {
  const authHeader = req.headers.authorization;
  
  console.log('🔐 [Live Status] Auth Debug:', {
    hasAuthHeader: !!authHeader,
    authHeaderPreview: authHeader?.substring(0, 30),
    headers: Object.keys(req.headers),
    method: req.method,
    url: req.url
  });
  
  const token = authHeader?.replace('Bearer ', '');
  
  if (!token) {
    console.log('❌ [Live Status] No token found');
    return null;
  }

  try {
    console.log('🔍 [Live Status] Verifying token...', {
      tokenLength: token.length,
      tokenPreview: token.substring(0, 20),
      hasJwtSecret: !!process.env.JWT_SECRET
    });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    console.log('✅ [Live Status] Token verified:', {
      userId: decoded.userId,
      email: decoded.email,
      exp: new Date(decoded.exp * 1000).toISOString()
    });
    
    return decoded;
  } catch (error: any) {
    console.error('❌ [Live Status] Token verification failed:', {
      error: error.message,
      name: error.name,
      tokenPreview: token.substring(0, 20)
    });
    return null;
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

    const userId = req.query.userId as string || authUser.userId;

    // Check cache first
    const cacheKey = `live_status_${userId}`;
    const cached = liveStatusCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      console.log('[Live Status] ✅ Cache hit (age: ' + Math.round((Date.now() - cached.timestamp) / 1000) + 's)');
      return res.status(200).json(cached.data);
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get current active session
    let activeSession = await db.collection('clock_sessions').findOne({
      userId,
      status: 'active'
    });

    // ✅ FALLBACK: Check user document if no session found
    if (!activeSession) {
      const user = await db.collection('users').findOne(
        { $or: [{ userId }, { ghlUserId: userId }] },
        { projection: { isClockedIn: 1, lastClockIn: 1, _id: 1 } }
      );
      
      // If user.isClockedIn is true but no session exists, find the most recent session
      if (user?.isClockedIn && user?.lastClockIn) {
        console.log('[Live Status] User marked as clocked in, finding recent session...');
        
        // Find most recent session (might be improperly marked as completed)
        const recentSession = await db.collection('clock_sessions').findOne(
          {
            userId,
            clockInTime: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
          },
          { sort: { clockInTime: -1 } }
        );
        
        if (recentSession && !recentSession.clockOutTime) {
          console.log('[Live Status] Found recent session without clock-out, treating as active');
          // Fix the session status
          await db.collection('clock_sessions').updateOne(
            { _id: recentSession._id },
            { $set: { status: 'active' } }
          );
          activeSession = { ...recentSession, status: 'active' };
        } else {
          // ✅ SAFETY: No valid session found, but user marked as clocked in
          // This means data is inconsistent - fix the user flag
          console.log('[Live Status] No valid session found, fixing user.isClockedIn flag');
          await db.collection('users').updateOne(
            { _id: user._id },
            { 
              $set: { 
                isClockedIn: false,
                lastClockOut: new Date()
              } 
            }
          );
          // activeSession remains null, will return isActive: false
        }
      }
    }

    // ✅ FAST: Use MongoDB aggregation to calculate totals on database side
    const todayStart = startOfDay(new Date());
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

    // Calculate today's stats with aggregation
    const todayPipeline = await db.collection('clock_sessions').aggregate([
      {
        $match: {
          userId,
          clockInTime: { $gte: todayStart },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: '$workHours' },
          totalEndMileage: { $sum: { $ifNull: ['$endMileage', 0] } }, // Only sum endMileage
          breakMinutes: { $sum: { $divide: [{ $ifNull: ['$breakDurationMs', 0] }, 60000] } },
          sessionCount: { $sum: 1 }
        }
      }
    ]).toArray();

    const todayStats = todayPipeline[0] || {
      totalHours: 0,
      totalEndMileage: 0,
      breakMinutes: 0,
      sessionCount: 0
    };

    // Add current active session time to today's stats
    if (activeSession) {
      const duration = Date.now() - new Date(activeSession.clockInTime).getTime();
      let workDuration = duration;
      
      // Subtract break time
      if (activeSession.onBreak && activeSession.breaks?.length > 0) {
        const currentBreak = activeSession.breaks[activeSession.breaks.length - 1];
        if (!currentBreak.endTime) {
          workDuration -= (Date.now() - new Date(currentBreak.startTime).getTime());
        }
      }
      
      const completedBreakTime = (activeSession.breaks || []).reduce((total: number, breakItem: any) => {
        if (breakItem.endTime) {
          return total + (new Date(breakItem.endTime).getTime() - new Date(breakItem.startTime).getTime());
        }
        return total;
      }, 0);
      
      workDuration -= completedBreakTime;
      
      todayStats.totalHours += workDuration / (1000 * 60 * 60);
    }

    // Calculate week's stats with aggregation
    const weekPipeline = await db.collection('clock_sessions').aggregate([
      {
        $match: {
          userId,
          clockInTime: { $gte: weekStart },
          status: 'completed' // Only completed sessions have endMileage
        }
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: '$workHours' },
          totalEndMileage: { $sum: { $ifNull: ['$endMileage', 0] } } // Only sum endMileage
        }
      }
    ]).toArray();

    const weekStats = weekPipeline[0] || {
      totalHours: 0,
      totalEndMileage: 0
    };

    // Add current active session to week stats
    if (activeSession) {
      const duration = Date.now() - new Date(activeSession.clockInTime).getTime();
      let workDuration = duration;
      
      if (activeSession.onBreak && activeSession.breaks?.length > 0) {
        const currentBreak = activeSession.breaks[activeSession.breaks.length - 1];
        if (!currentBreak.endTime) {
          workDuration -= (Date.now() - new Date(currentBreak.startTime).getTime());
        }
      }
      
      const completedBreakTime = (activeSession.breaks || []).reduce((total: number, breakItem: any) => {
        if (breakItem.endTime) {
          return total + (new Date(breakItem.endTime).getTime() - new Date(breakItem.startTime).getTime());
        }
        return total;
      }, 0);
      
      workDuration -= completedBreakTime;
      weekStats.totalHours += workDuration / (1000 * 60 * 60);
    }

    // Get user's details and labor rules
    const user = await db.collection('users').findOne({ ghlUserId: userId });
    const locationId = user?.locationId || authUser.locationId;
    
    // Get labor rules for overtime calculation
    const laborRules = await db.collection('labor_rules').findOne({
      locationId,
      effectiveDate: { $lte: new Date() },
      $or: [
        { expiryDate: { $gte: new Date() } },
        { expiryDate: null }
      ]
    });

    const overtimeThreshold = laborRules?.rules?.overtime?.weeklyThreshold || 40;
    const overtimeMultiplier = laborRules?.rules?.overtime?.multiplier || 1.5;
    
    // Get user's custom rate if exists
    const userProfile = await db.collection('user_labor_profiles').findOne({
      userId,
      active: true
    });
    
    const hourlyRate = userProfile?.profile?.hourlyRate || user?.hourlyRate || 0;

    // Calculate overtime properly
    const regularHours = Math.min(weekStats.totalHours, overtimeThreshold);
    const overtimeHours = Math.max(weekStats.totalHours - overtimeThreshold, 0);
    const weeklyEarnings = (regularHours * hourlyRate) + (overtimeHours * hourlyRate * overtimeMultiplier);

    // Build response
    const response = {
      userId,
      isActive: !!activeSession,
      currentSession: activeSession ? {
        sessionId: activeSession._id,
        startTime: activeSession.clockInTime,
        duration: Date.now() - new Date(activeSession.clockInTime).getTime(),
        currentMiles: null, // No endMileage until clock out
        onBreak: activeSession.onBreak || false,
        breakType: activeSession.currentBreakType
      } : null,
      today: {
        totalHours: todayStats.totalHours,
        formattedTime: formatDuration(todayStats.totalHours * 60 * 60 * 1000),
        totalMiles: todayStats.totalEndMileage || 0, // Use endMileage sum
        breakMinutes: todayStats.breakMinutes,
        sessionCount: todayStats.sessionCount,
        estimatedEarnings: todayStats.totalHours * hourlyRate
      },
      week: {
        totalHours: weekStats.totalHours,
        formattedTime: formatDuration(weekStats.totalHours * 60 * 60 * 1000),
        totalMiles: weekStats.totalEndMileage || 0, // Use endMileage sum
        regularHours,
        overtimeHours,
        estimatedEarnings: weeklyEarnings
      },
      userDetails: {
        hourlyRate,
        overtimeThreshold,
        laborRulesSource: laborRules?.ruleName || 'Default'
      },
      lastUpdate: new Date()
    };

    // Cache the response
    liveStatusCache.set(cacheKey, {
      data: response,
      timestamp: Date.now()
    });

    // Set cache headers for real-time updates
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    return res.status(200).json(response);

  } catch (error: any) {
    console.error('Live status error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}