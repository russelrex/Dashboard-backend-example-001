// pages/api/payroll/export.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { startOfWeek, endOfWeek, format } from 'date-fns';
import { Parser } from 'json2csv';

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

    // Check if user has manager/admin role
    if (!['manager', 'admin', 'owner'].includes(authUser.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { startDate, endDate, format: exportFormat = 'csv', locationId } = req.query;

    // Parse dates
    const start = startDate 
      ? new Date(startDate as string)
      : startOfWeek(new Date(), { weekStartsOn: 1 });
    
    const end = endDate
      ? new Date(endDate as string)
      : endOfWeek(start, { weekStartsOn: 1 });

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Build query
    const query: any = {
      clockInTime: {
        $gte: start,
        $lte: end
      },
      status: 'completed' // Only export completed sessions
    };

    if (locationId) {
      query.locationId = locationId as string;
    } else if (authUser.locationId) {
      query.locationId = authUser.locationId;
    }

    // Get labor rules for accurate calculations
    const laborRules = await db.collection('labor_rules').findOne({
      locationId: query.locationId,
      effectiveDate: { $lte: end },
      $or: [
        { expiryDate: { $gte: start } },
        { expiryDate: null }
      ]
    });

    const overtimeThreshold = laborRules?.rules?.overtime?.weeklyThreshold || 40;
    const overtimeMultiplier = laborRules?.rules?.overtime?.multiplier || 1.5;
    const mileageRate = laborRules?.rules?.mileage?.reimbursementRate || 0.67;

    // Get all sessions
    const sessions = await db.collection('clock_sessions')
      .find(query)
      .sort({ clockInTime: 1 })
      .toArray();

    // Get user details
    const userIds = [...new Set(sessions.map(s => s.userId))];
    const users = await db.collection('users')
      .find({ _id: { $in: userIds.map(id => new ObjectId(id)) } })
      .toArray();

    const userMap = new Map();
    users.forEach(user => {
      userMap.set(user._id.toString(), user);
    });

    // Get user labor profiles for custom rates
    const userProfiles = await db.collection('user_labor_profiles')
      .find({
        userId: { $in: userIds },
        active: true
      })
      .toArray();

    const profileMap = new Map();
    userProfiles.forEach(profile => {
      profileMap.set(profile.userId, profile);
    });

    // Process payroll data
    const payrollData = userIds.map(userId => {
      const user = userMap.get(userId);
      const userProfile = profileMap.get(userId);
      const userSessions = sessions.filter(s => s.userId === userId);
      
      const totals = userSessions.reduce((acc, session) => {
        const workHours = session.workHours || 
          ((new Date(session.clockOutTime).getTime() - new Date(session.clockInTime).getTime()) / (1000 * 60 * 60));
        
        acc.totalHours += workHours;
        acc.totalMiles += session.totalMiles || 0;
        acc.drivingMiles += session.drivingMiles || 0;
        acc.sessionCount++;
        
        // Track break time
        const breakMs = session.breakDurationMs || 0;
        acc.totalBreakMinutes += breakMs / (1000 * 60);
        
        return acc;
      }, {
        totalHours: 0,
        totalMiles: 0,
        drivingMiles: 0,
        sessionCount: 0,
        totalBreakMinutes: 0
      });

      // Use custom rates if available
      const hourlyRate = userProfile?.profile?.hourlyRate || user?.hourlyRate || 0;
      const userMileageRate = userProfile?.profile?.mileageRate || mileageRate;
      const isOvertimeExempt = userProfile?.profile?.overtimeExempt || false;

      let regularHours = totals.totalHours;
      let overtimeHours = 0;
      
      if (!isOvertimeExempt && totals.totalHours > overtimeThreshold) {
        regularHours = overtimeThreshold;
        overtimeHours = totals.totalHours - overtimeThreshold;
      }

      const regularPay = regularHours * hourlyRate;
      const overtimePay = overtimeHours * hourlyRate * overtimeMultiplier;
      const mileageReimbursement = totals.totalMiles * userMileageRate;

      return {
        employeeId: user?.employeeId || user?.ghlUserId || userId,
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
        email: user?.email || '',
        department: user?.department || userProfile?.profile?.defaultDepartment || '',
        totalHours: Number(totals.totalHours.toFixed(2)),
        regularHours: Number(regularHours.toFixed(2)),
        overtimeHours: Number(overtimeHours.toFixed(2)),
        breakMinutes: Number(totals.totalBreakMinutes.toFixed(2)),
        hourlyRate,
        overtimeRate: hourlyRate * overtimeMultiplier,
        regularPay: Number(regularPay.toFixed(2)),
        overtimePay: Number(overtimePay.toFixed(2)),
        totalMiles: Number(totals.totalMiles.toFixed(2)),
        drivingMiles: Number(totals.drivingMiles.toFixed(2)),
        mileageRate: userMileageRate,
        mileageReimbursement: Number(mileageReimbursement.toFixed(2)),
        grossPay: Number((regularPay + overtimePay).toFixed(2)),
        totalPay: Number((regularPay + overtimePay + mileageReimbursement).toFixed(2)),
        sessionCount: totals.sessionCount,
        periodStart: format(start, 'yyyy-MM-dd'),
        periodEnd: format(end, 'yyyy-MM-dd'),
        overtimeExempt: isOvertimeExempt ? 'Y' : 'N'
      };
    });

    // Sort by last name
    payrollData.sort((a, b) => a.lastName.localeCompare(b.lastName));

    if (exportFormat === 'json') {
      return res.status(200).json({
        period: {
          start,
          end
        },
        locationId: query.locationId,
        laborRules: {
          source: laborRules?.ruleName || 'Default',
          overtimeThreshold,
          overtimeMultiplier,
          mileageRate
        },
        employees: payrollData,
        summary: {
          totalEmployees: payrollData.length,
          totalHours: payrollData.reduce((sum, e) => sum + e.totalHours, 0),
          totalRegularPay: payrollData.reduce((sum, e) => sum + e.regularPay, 0),
          totalOvertimePay: payrollData.reduce((sum, e) => sum + e.overtimePay, 0),
          totalMileageReimbursement: payrollData.reduce((sum, e) => sum + e.mileageReimbursement, 0),
          totalGrossPay: payrollData.reduce((sum, e) => sum + e.grossPay, 0),
          totalPay: payrollData.reduce((sum, e) => sum + e.totalPay, 0)
        },
        generated: new Date()
      });
    } else {
      // CSV export
      const fields = [
        'employeeId',
        'firstName', 
        'lastName',
        'email',
        'department',
        'periodStart',
        'periodEnd',
        'totalHours',
        'regularHours',
        'overtimeHours',
        'breakMinutes',
        'hourlyRate',
        'overtimeRate',
        'regularPay',
        'overtimePay',
        'totalMiles',
        'drivingMiles',
        'mileageRate',
        'mileageReimbursement',
        'grossPay',
        'totalPay',
        'sessionCount',
        'overtimeExempt'
      ];

      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(payrollData);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition', 
        `attachment; filename="payroll_${format(start, 'yyyy-MM-dd')}_${format(end, 'yyyy-MM-dd')}.csv"`
      );
      
      return res.status(200).send(csv);
    }

  } catch (error: any) {
    console.error('Payroll export error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}