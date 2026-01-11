// pages/api/payroll/calculate.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import { startOfWeek, endOfWeek, eachDayOfInterval, isWithinInterval } from 'date-fns';

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

    const { 
      userId, 
      startDate, 
      endDate,
      locationId,
      preview = true // If true, don't save calculations
    } = req.body;

    if (!userId || !startDate || !endDate || !locationId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get user details
    const user = await db.collection('users').findOne({
      ghlUserId: userId
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get labor rules for location
    const laborRules = await db.collection('labor_rules').findOne({
      locationId,
      effectiveDate: { $lte: new Date(endDate) },
      $or: [
        { expiryDate: { $gte: new Date(startDate) } },
        { expiryDate: null }
      ]
    });

    if (!laborRules) {
      return res.status(404).json({ error: 'No labor rules found for location' });
    }

    // Get all clock sessions in date range
    const sessions = await db.collection('clock_sessions').find({
      userId,
      locationId,
      clockInTime: { $gte: new Date(startDate) },
      clockOutTime: { $lte: new Date(endDate) },
      status: 'completed'
    }).sort({ clockInTime: 1 }).toArray();

    // Calculate payroll based on rules
    const payrollData = calculatePayrollWithRules(
      sessions,
      user,
      laborRules.rules,
      new Date(startDate),
      new Date(endDate)
    );

    // Save calculation if not preview
    if (!preview) {
      const payrollRecord = {
        _id: new ObjectId(),
        userId,
        locationId,
        periodStart: new Date(startDate),
        periodEnd: new Date(endDate),
        ...payrollData,
        laborRulesId: laborRules._id,
        laborRulesVersion: laborRules.version,
        status: 'calculated',
        calculatedAt: new Date(),
        calculatedBy: authUser.userId
      };

      await db.collection('payroll_calculations').insertOne(payrollRecord);

      // Mark sessions as processed
      await db.collection('clock_sessions').updateMany(
        {
          _id: { $in: sessions.map(s => s._id) }
        },
        {
          $set: {
            payrollCalculationId: payrollRecord._id,
            payrollProcessed: true,
            payrollProcessedAt: new Date()
          }
        }
      );

      return res.status(200).json({
        success: true,
        payrollId: payrollRecord._id,
        ...payrollData
      });
    }

    return res.status(200).json({
      success: true,
      preview: true,
      ...payrollData
    });

  } catch (error: any) {
    console.error('Payroll calculation error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

function calculatePayrollWithRules(
  sessions: any[],
  user: any,
  rules: any,
  startDate: Date,
  endDate: Date
) {
  const baseRate = user.hourlyRate || rules.minimumWage?.standard || 15;
  
  // Group sessions by day
  const sessionsByDay = new Map<string, any[]>();
  const daysInPeriod = eachDayOfInterval({ start: startDate, end: endDate });
  
  // Initialize all days
  daysInPeriod.forEach(day => {
    sessionsByDay.set(day.toISOString().split('T')[0], []);
  });
  
  // Group sessions
  sessions.forEach(session => {
    const dayKey = new Date(session.clockInTime).toISOString().split('T')[0];
    const existing = sessionsByDay.get(dayKey) || [];
    existing.push(session);
    sessionsByDay.set(dayKey, existing);
  });

  // Calculate daily totals
  let totalRegularHours = 0;
  let totalOvertimeHours = 0;
  let totalDoubleTimeHours = 0;
  let totalBreakViolationPenalties = 0;
  let totalMiles = 0;
  let totalDrivingMiles = 0;
  const dailyDetails: any[] = [];

  // Track consecutive days worked (for California 7th day rule)
  let consecutiveDaysWorked = 0;
  let lastWorkDay: Date | null = null;

  // Process each day
  Array.from(sessionsByDay.entries()).forEach(([dateStr, daySessions]) => {
    const currentDay = new Date(dateStr);
    
    // Check consecutive days
    if (lastWorkDay) {
      const dayDiff = (currentDay.getTime() - lastWorkDay.getTime()) / (1000 * 60 * 60 * 24);
      if (dayDiff === 1) {
        consecutiveDaysWorked++;
      } else if (daySessions.length > 0) {
        consecutiveDaysWorked = 1;
      }
    } else if (daySessions.length > 0) {
      consecutiveDaysWorked = 1;
    }
    
    if (daySessions.length > 0) {
      lastWorkDay = currentDay;
    }

    // Calculate day's hours
    let dayHours = 0;
    let dayBreakMinutes = 0;
    let dayMiles = 0;
    let dayDrivingMiles = 0;
    let firstClockIn: Date | null = null;
    let lastClockOut: Date | null = null;
    
    daySessions.forEach(session => {
      const sessionHours = session.workHours || 
        ((new Date(session.clockOutTime).getTime() - new Date(session.clockInTime).getTime()) / (1000 * 60 * 60));
      
      dayHours += sessionHours;
      dayMiles += session.totalMiles || 0;
      dayDrivingMiles += session.drivingMiles || 0;
      
      // Track first/last times for spread of hours
      if (!firstClockIn || new Date(session.clockInTime) < firstClockIn) {
        firstClockIn = new Date(session.clockInTime);
      }
      if (!lastClockOut || new Date(session.clockOutTime) > lastClockOut) {
        lastClockOut = new Date(session.clockOutTime);
      }
      
      // Calculate break time
      (session.breaks || []).forEach((breakItem: any) => {
        if (breakItem.endTime) {
          dayBreakMinutes += (new Date(breakItem.endTime).getTime() - 
                             new Date(breakItem.startTime).getTime()) / (1000 * 60);
        }
      });
    });

    totalMiles += dayMiles;
    totalDrivingMiles += dayDrivingMiles;

    // Apply daily overtime rules if applicable
    let dayRegularHours = 0;
    let dayOvertimeHours = 0;
    let dayDoubleTimeHours = 0;
    
    if (rules.overtime?.calculateDaily && rules.overtime?.dailyThreshold) {
      // California-style daily overtime
      const dailyThreshold = rules.overtime.dailyThreshold;
      const doubleTimeThreshold = rules.overtime.doubleTimeThreshold || Infinity;
      
      if (dayHours > doubleTimeThreshold) {
        dayDoubleTimeHours = dayHours - doubleTimeThreshold;
        dayOvertimeHours = doubleTimeThreshold - dailyThreshold;
        dayRegularHours = dailyThreshold;
      } else if (dayHours > dailyThreshold) {
        dayOvertimeHours = dayHours - dailyThreshold;
        dayRegularHours = dailyThreshold;
      } else {
        dayRegularHours = dayHours;
      }
      
      // California 7th day rule
      if (rules.overtime?.seventhDayRule && consecutiveDaysWorked === 7) {
        // First 8 hours on 7th day are OT
        if (dayRegularHours > 0) {
          dayOvertimeHours += dayRegularHours;
          dayRegularHours = 0;
        }
      }
    } else {
      // Only weekly overtime
      dayRegularHours = dayHours;
    }

    // Check break compliance
    let breakViolations = 0;
    
    // Check meal breaks
    if (rules.breaks?.mealBreaks) {
      rules.breaks.mealBreaks.forEach((mealRule: any) => {
        if (dayHours >= mealRule.afterHours) {
          // Check if meal break was taken
          const mealBreakTaken = daySessions.some(session => 
            (session.breaks || []).some((b: any) => 
              b.type === 'lunch' && b.duration >= mealRule.duration * 60 * 1000
            )
          );
          
          if (!mealBreakTaken && mealRule.mandatory && mealRule.penalty) {
            breakViolations += mealRule.penalty;
          }
        }
      });
    }
    
    // Check paid breaks
    if (rules.breaks?.paidBreaks) {
      rules.breaks.paidBreaks.forEach((breakRule: any) => {
        if (dayHours >= breakRule.afterHours && breakRule.mandatory) {
          const breakTaken = daySessions.some(session => 
            (session.breaks || []).some((b: any) => 
              b.type === 'break' && b.duration >= breakRule.duration * 60 * 1000
            )
          );
          
          if (!breakTaken && breakRule.penalty) {
            breakViolations += breakRule.penalty || 0;
          }
        }
      });
    }
    
    totalBreakViolationPenalties += breakViolations;

    // Check spread of hours (NY rule)
    let spreadOfHoursPay = 0;
    if (rules.overtime?.spreadOfHours && firstClockIn && lastClockOut) {
      const spreadHours = (lastClockOut.getTime() - firstClockIn.getTime()) / (1000 * 60 * 60);
      if (spreadHours > rules.overtime.spreadOfHours) {
        spreadOfHoursPay = 1; // One hour extra pay
        dayRegularHours += 1;
      }
    }

    // Add to totals
    totalRegularHours += dayRegularHours;
    totalOvertimeHours += dayOvertimeHours;
    totalDoubleTimeHours += dayDoubleTimeHours;

    dailyDetails.push({
      date: dateStr,
      hours: dayHours,
      regularHours: dayRegularHours,
      overtimeHours: dayOvertimeHours,
      doubleTimeHours: dayDoubleTimeHours,
      breakMinutes: dayBreakMinutes,
      breakViolations,
      spreadOfHoursPay,
      miles: dayMiles,
      sessions: daySessions.length,
      consecutiveDay: consecutiveDaysWorked
    });
  });

  // Apply weekly overtime if not using daily
  if (!rules.overtime?.calculateDaily && rules.overtime?.weeklyThreshold) {
    const totalHours = totalRegularHours;
    if (totalHours > rules.overtime.weeklyThreshold) {
      totalOvertimeHours = totalHours - rules.overtime.weeklyThreshold;
      totalRegularHours = rules.overtime.weeklyThreshold;
    }
  }

  // Calculate pay
  const regularPay = totalRegularHours * baseRate;
  const overtimePay = totalOvertimeHours * baseRate * (rules.overtime?.multiplier || 1.5);
  const doubleTimePay = totalDoubleTimeHours * baseRate * (rules.overtime?.doubleTimeMultiplier || 2.0);
  const breakPenaltyPay = totalBreakViolationPenalties * baseRate;
  
  // Mileage reimbursement
  const mileageRate = rules.mileage?.reimbursementRate || 0.67;
  const mileageReimbursement = totalMiles * mileageRate;

  // Calculate taxes (simplified - you'd want more complex logic)
  const grossPay = regularPay + overtimePay + doubleTimePay + breakPenaltyPay;
  const federalTax = grossPay * 0.12; // Simplified
  const stateTax = grossPay * 0.05; // Simplified
  const socialSecurity = grossPay * 0.062;
  const medicare = grossPay * 0.0145;
  const totalTaxes = federalTax + stateTax + socialSecurity + medicare;
  const netPay = grossPay - totalTaxes + mileageReimbursement; // Mileage is non-taxable

  return {
    period: {
      start: startDate,
      end: endDate,
      days: daysInPeriod.length,
      workDays: dailyDetails.filter(d => d.hours > 0).length
    },
    hours: {
      regular: Number(totalRegularHours.toFixed(2)),
      overtime: Number(totalOvertimeHours.toFixed(2)),
      doubleTime: Number(totalDoubleTimeHours.toFixed(2)),
      total: Number((totalRegularHours + totalOvertimeHours + totalDoubleTimeHours).toFixed(2))
    },
    earnings: {
      regularPay: Number(regularPay.toFixed(2)),
      overtimePay: Number(overtimePay.toFixed(2)),
      doubleTimePay: Number(doubleTimePay.toFixed(2)),
      breakPenalties: Number(breakPenaltyPay.toFixed(2)),
      grossPay: Number(grossPay.toFixed(2))
    },
    deductions: {
      federalTax: Number(federalTax.toFixed(2)),
      stateTax: Number(stateTax.toFixed(2)),
      socialSecurity: Number(socialSecurity.toFixed(2)),
      medicare: Number(medicare.toFixed(2)),
      totalDeductions: Number(totalTaxes.toFixed(2))
    },
    reimbursements: {
      mileage: Number(mileageReimbursement.toFixed(2)),
      totalMiles: Number(totalMiles.toFixed(2)),
      drivingMiles: Number(totalDrivingMiles.toFixed(2)),
      mileageRate: mileageRate
    },
    netPay: Number(netPay.toFixed(2)),
    appliedRules: {
      name: rules.ruleName || 'Custom Rules',
      hourlyRate: baseRate,
      overtimeMultiplier: rules.overtime?.multiplier || 1.5,
      doubleTimeMultiplier: rules.overtime?.doubleTimeMultiplier || 2.0,
      dailyOvertimeThreshold: rules.overtime?.dailyThreshold,
      weeklyOvertimeThreshold: rules.overtime?.weeklyThreshold
    },
    dailyBreakdown: dailyDetails
  };
}