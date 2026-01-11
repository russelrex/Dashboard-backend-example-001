// pages/api/payroll/approve.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { startOfWeek, endOfWeek } from 'date-fns';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authUser = await verifyAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check permissions
    if (!['manager', 'admin', 'owner'].includes(authUser.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { 
      weekStart,
      locationId,
      approvalType = 'weekly', // 'weekly', 'individual', 'adjustment'
      targetIds, // array of session IDs or adjustment IDs
      action, // 'approve' or 'reject'
      notes
    } = req.body;

    const client = await clientPromise;
    const db = client.db(getDbName());

    if (approvalType === 'weekly') {
      // Approve entire week for a location
      const weekStartDate = new Date(weekStart);
      const weekEndDate = endOfWeek(weekStartDate, { weekStartsOn: 1 });

      // Create payroll period record
      const payrollPeriod = {
        _id: new ObjectId(),
        locationId: locationId || authUser.locationId,
        weekStart: weekStartDate,
        weekEnd: weekEndDate,
        status: 'approved',
        approvedBy: authUser.userId,
        approvedAt: new Date(),
        notes,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const periodResult = await db.collection('payroll_periods').insertOne(payrollPeriod);

      // Lock all sessions for this period
      await db.collection('clock_sessions').updateMany(
        {
          locationId: payrollPeriod.locationId,
          clockInTime: {
            $gte: weekStartDate,
            $lte: weekEndDate
          },
          status: 'completed'
        },
        {
          $set: {
            payrollPeriodId: periodResult.insertedId,
            locked: true,
            lockedAt: new Date(),
            lockedBy: authUser.userId
          }
        }
      );

      // Get summary for response
      const summary = await db.collection('clock_sessions').aggregate([
        {
          $match: {
            payrollPeriodId: periodResult.insertedId
          }
        },
        {
          $group: {
            _id: null,
            totalSessions: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' },
            totalHours: {
              $sum: {
                $divide: [
                  { $subtract: ['$clockOutTime', '$clockInTime'] },
                  1000 * 60 * 60
                ]
              }
            },
            totalMiles: { $sum: '$totalMiles' }
          }
        }
      ]).toArray();

      const stats = summary[0] || { 
        totalSessions: 0, 
        uniqueUsers: [], 
        totalHours: 0, 
        totalMiles: 0 
      };

      // Log activity
      await db.collection('activity_logs').insertOne({
        _id: new ObjectId(),
        type: 'payroll_period_approved',
        userId: authUser.userId,
        locationId: payrollPeriod.locationId,
        timestamp: new Date(),
        metadata: {
          periodId: periodResult.insertedId,
          weekStart: weekStartDate,
          weekEnd: weekEndDate,
          stats: {
            sessions: stats.totalSessions,
            employees: stats.uniqueUsers.length,
            hours: Math.round(stats.totalHours * 100) / 100,
            miles: Math.round(stats.totalMiles * 100) / 100
          }
        }
      });

      return res.status(200).json({
        success: true,
        periodId: periodResult.insertedId,
        message: `Payroll period approved for week of ${weekStartDate.toLocaleDateString()}`,
        summary: {
          sessionsLocked: stats.totalSessions,
          employeesAffected: stats.uniqueUsers.length,
          totalHours: Math.round(stats.totalHours * 100) / 100,
          totalMiles: Math.round(stats.totalMiles * 100) / 100
        }
      });

    } else if (approvalType === 'adjustment') {
      // Approve/reject time adjustments
      if (!targetIds || !Array.isArray(targetIds)) {
        return res.status(400).json({ error: 'Target IDs required' });
      }

      const objectIds = targetIds.map(id => new ObjectId(id));
      
      if (action === 'approve') {
        // Get adjustments to apply
        const adjustments = await db.collection('time_adjustments')
          .find({ _id: { $in: objectIds }, status: 'pending' })
          .toArray();

        // Apply each adjustment
        for (const adj of adjustments) {
          // Recalculate duration based on adjusted times
          const clockIn = new Date(adj.adjusted.clockIn);
          const clockOut = adj.adjusted.clockOut ? new Date(adj.adjusted.clockOut) : null;
          
          let updateData: any = {
            clockInTime: clockIn,
            hasAdjustments: true,
            lastAdjustmentId: adj._id,
            updatedAt: new Date()
          };

          if (clockOut) {
            updateData.clockOutTime = clockOut;
            
            // Recalculate durations
            const totalDurationMs = clockOut.getTime() - clockIn.getTime();
            
            // Get session to calculate break time
            const session = await db.collection('clock_sessions').findOne({ _id: adj.sessionId });
            const totalBreakMs = (session?.breaks || []).reduce((total: number, breakItem: any) => {
              if (breakItem.endTime) {
                return total + (new Date(breakItem.endTime).getTime() - new Date(breakItem.startTime).getTime());
              }
              return total;
            }, 0);

            const workDurationMs = totalDurationMs - totalBreakMs;
            const workHours = workDurationMs / (1000 * 60 * 60);

            updateData.totalDurationMs = totalDurationMs;
            updateData.workDurationMs = workDurationMs;
            updateData.workHours = workHours;
          }

          // Update the session
          await db.collection('clock_sessions').updateOne(
            { _id: adj.sessionId },
            { $set: updateData }
          );

          // Update adjustment status
          await db.collection('time_adjustments').updateOne(
            { _id: adj._id },
            {
              $set: {
                status: 'approved',
                approvedBy: authUser.userId,
                approvedAt: new Date(),
                approverNotes: notes
              }
            }
          );

          // Log activity
          await db.collection('activity_logs').insertOne({
            _id: new ObjectId(),
            type: 'adjustment_approved',
            userId: authUser.userId,
            targetUserId: adj.userId,
            adjustmentId: adj._id,
            sessionId: adj.sessionId,
            timestamp: new Date(),
            metadata: {
              adjustmentType: adj.adjustmentType,
              originalTimes: adj.original,
              adjustedTimes: adj.adjusted
            }
          });
        }

        return res.status(200).json({
          success: true,
          message: `${adjustments.length} time adjustments approved`,
          adjustmentIds: adjustments.map(a => a._id)
        });

      } else if (action === 'reject') {
        // Reject adjustments
        await db.collection('time_adjustments').updateMany(
          { _id: { $in: objectIds }, status: 'pending' },
          {
            $set: {
              status: 'rejected',
              rejectedBy: authUser.userId,
              rejectedAt: new Date(),
              rejectionReason: notes
            }
          }
        );

        // Log rejections
        for (const id of objectIds) {
          await db.collection('activity_logs').insertOne({
            _id: new ObjectId(),
            type: 'adjustment_rejected',
            userId: authUser.userId,
            adjustmentId: id,
            timestamp: new Date(),
            metadata: {
              reason: notes
            }
          });
        }

        return res.status(200).json({
          success: true,
          message: `${targetIds.length} time adjustments rejected`
        });
      }
    }

    return res.status(400).json({ error: 'Invalid approval type or action' });

  } catch (error: any) {
    console.error('Payroll approval error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}