// File: pages/api/cron/automation-scheduler.ts
// Created: December 2024
// Description: Cron job for checking time-based automation triggers

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  
  if (!isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  try {
    // Stage-delay triggers are now handled at stage entry time, not here
    console.log('Stage-delay automations are pre-scheduled when projects enter stages');

    // Check for recurring schedule triggers
    const recurringRules = await db.collection('automation_rules').find({
      isActive: true,
      'trigger.type': 'recurring-schedule'
    }).toArray();

    for (const rule of recurringRules) {
      // Check if it's time to run based on schedule
      const shouldRun = checkSchedule(rule.trigger.config);
      
      if (shouldRun) {
        // Check last execution time
        const lastRun = rule.executionStats?.lastExecuted;
        const now = new Date();
        
        // Only run if hasn't run today (for daily) or this hour (for hourly)
        if (!lastRun || !isSameInterval(lastRun, now, rule.trigger.config)) {
          // Queue automation
          await db.collection('automation_queue').insertOne({
            ruleId: rule._id,
            trigger: {
              type: 'recurring-schedule',
              locationId: rule.locationId,
              timestamp: now
            },
            status: 'pending',
            createdAt: now,
            attempts: 0
          });
        }
      }
    }

    // Check for appointment reminders
    const appointmentRules = await db.collection('automation_rules').find({
      isActive: true,
      'trigger.type': 'before-appointment'
    }).toArray();

    // PROCESS SCHEDULED QUEUE ITEMS (TIME-BASED AUTOMATIONS)
    const now = new Date();
    const scheduledItems = await db.collection('automation_queue').find({
      status: 'scheduled',
      scheduledFor: { $lte: now },
      attempts: { $lt: 3 }
    }).toArray();

    console.log(`Found ${scheduledItems.length} scheduled automation items ready for processing`);

    // Move scheduled items to pending status so they can be processed
    for (const item of scheduledItems) {
      await db.collection('automation_queue').updateOne(
        { _id: item._id },
        { 
          $set: { 
            status: 'pending',
            scheduledFor: null  // Clear the scheduled time since it's now pending
          }
        }
      );
      console.log(`Moved scheduled item ${item._id} to pending status (${item.metadata?.triggerType || 'unknown trigger'})`);
    }

    for (const rule of appointmentRules) {
      const hoursBeforeMs = (rule.trigger.config.delayAmount || 24) * 3600000;
      const reminderTime = new Date(Date.now() + hoursBeforeMs);
      
      // ✅ Find appointments that need reminders - MATCH BY CALENDAR
      const appointmentQuery: any = {
        locationId: rule.locationId,
        startTime: {
          $gte: reminderTime,
          $lt: new Date(reminderTime.getTime() + 300000) // 5 minute window
        },
        [`automations.${rule._id}.reminderSent`]: { $ne: true }
      };

      // If rule has calendarId, only match appointments from that calendar
      if (rule.calendarId) {
        appointmentQuery.calendarId = rule.calendarId;
        console.log(`Filtering appointments for calendar: ${rule.calendarId}`);
      }

      const appointments = await db.collection('appointments').find(appointmentQuery).toArray();

      console.log(`Found ${appointments.length} appointments needing reminders for rule: ${rule.name}`);

      for (const appointment of appointments) {
        // Queue reminder
        await db.collection('automation_queue').insertOne({
          ruleId: rule._id,
          trigger: {
            type: 'before-appointment',
            locationId: appointment.locationId,
            contactId: appointment.contactId,
            appointmentId: appointment._id,
            data: appointment
          },
          status: 'pending',
          createdAt: new Date(),
          attempts: 0
        });

        // Mark reminder as sent
        await db.collection('appointments').updateOne(
          { _id: appointment._id },
          { $set: { [`automations.${rule._id}.reminderSent`]: true } }
        );
      }
    }

    return res.json({ 
      success: true,
      processed: {
        stageDelays: 'pre-scheduled at stage entry',
        recurringSchedules: recurringRules.length,
        appointmentReminders: appointmentRules.length,
        scheduledItems: scheduledItems.length
      }
    });
  } catch (error) {
    console.error('Automation scheduler error:', error);
    return res.status(500).json({ error: 'Failed to process scheduled automations' });
  }
}

function checkSchedule(config: any): boolean {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();
  const dayOfMonth = now.getDate();

  switch (config.frequency) {
    case 'hourly':
      return true;
    case 'daily':
      return hour === (config.hour || 9);
    case 'weekly':
      return dayOfWeek === (config.dayOfWeek || 1) && hour === (config.hour || 9);
    case 'monthly':
      return dayOfMonth === (config.dayOfMonth || 1) && hour === (config.hour || 9);
    default:
      return false;
  }
}

function isSameInterval(date1: Date, date2: Date, config: any): boolean {
  switch (config.frequency) {
    case 'hourly':
      return date1.getHours() === date2.getHours() && 
             date1.getDate() === date2.getDate();
    case 'daily':
      return date1.getDate() === date2.getDate() && 
             date1.getMonth() === date2.getMonth();
    case 'weekly':
      return getWeekNumber(date1) === getWeekNumber(date2);
    case 'monthly':
      return date1.getMonth() === date2.getMonth() && 
             date1.getFullYear() === date2.getFullYear();
    default:
      return false;
  }
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}