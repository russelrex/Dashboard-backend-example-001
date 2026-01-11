// src/services/automationQueueProcessor.ts
import { Db, ObjectId } from 'mongodb';
import axios from 'axios';
import { formatTimeWithTimezone, formatDateWithTimezone, getTimezoneWithPriority } from '../utils/timezoneUtils';

export class AutomationQueueProcessor {
  private db: Db;
  private isRunning: boolean = false;
  private intervalId?: any;
  private smsService?: any;
  private notificationService?: any;
  private emailService?: any;

  constructor(db: Db, services?: {
    smsService?: any;
    notificationService?: any;
    emailService?: any;
  }) {
    this.db = db;
    this.smsService = services?.smsService;
    this.notificationService = services?.notificationService;
    this.emailService = services?.emailService;
  }

  /**
   * Replace variables in text using context data
   * Enhanced with timezone-aware appointment time formatting
   */
  private replaceVariables(text: string, context: any): string {
    if (!text) return text;
    
    return text.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      const trimmedPath = path.trim();
      
      // SPECIAL HANDLING: {{appointment.time}} with timezone conversion
      if (trimmedPath === 'appointment.time') {
        // Get the appointment time (could be in various fields)
        const appointmentTime = context.appointment?.scheduledTime || 
                               context.appointment?.start || 
                               context.appointment?.startTime;
        
        if (!appointmentTime) {
          return match; // Keep original if no time found
        }
        
        // Get timezone in priority order: contact → user → location
        const timezone = getTimezoneWithPriority(
          context.contact,
          context.user,
          context.location
        );
        
        // Format the time with timezone
        const formattedTime = formatTimeWithTimezone(appointmentTime, timezone, true);
        
        console.log(`✅ [replaceVariables] Converted appointment.time: ${appointmentTime} → ${formattedTime} (${timezone})`);
        
        return formattedTime;
      }
      
      // SPECIAL HANDLING: {{appointment.date}} with timezone conversion
      if (trimmedPath === 'appointment.date') {
        const appointmentTime = context.appointment?.scheduledTime || 
                               context.appointment?.start || 
                               context.appointment?.startTime;
        
        if (!appointmentTime) {
          return match;
        }
        
        const timezone = getTimezoneWithPriority(
          context.contact,
          context.user,
          context.location
        );
        
        const formattedDate = formatDateWithTimezone(appointmentTime, timezone);
        
        return formattedDate;
      }
      
      // SPECIAL HANDLING: {{appointment.title}} - ensure we use appointment title, not project title
      if (trimmedPath === 'appointment.title') {
        const title = context.appointment?.title || 
                     context.appointment?.name || 
                     'your appointment';
        
        return title;
      }
      
      // NEW: SPECIAL HANDLING: {{reschedule.link}} or {{appointment.rescheduleLink}}
      if (trimmedPath === 'reschedule.link' || trimmedPath === 'appointment.rescheduleLink') {
        const calendarId = context.appointment?.calendarId || context.event?.calendarId;
        const ghlAppointmentId = context.appointment?.ghlAppointmentId || context.appointment?.appointmentId;
        
        if (calendarId && ghlAppointmentId) {
          const link = `https://updates.leadprospecting.ai/widget/booking/${calendarId}?event_id=${ghlAppointmentId}`;
          console.log('✅ Generated reschedule link:', link);
          return link;
        } else {
          console.warn('⚠️ Missing calendarId or ghlAppointmentId for reschedule link', {
            hasCalendarId: !!calendarId,
            hasGhlAppointmentId: !!ghlAppointmentId
          });
          return 'reschedule link unavailable';
        }
      }
      
      // DEFAULT HANDLING: Standard variable replacement
      const keys = trimmedPath.split('.');
      let value = context;
      
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined || value === null) {
          return match; // Keep original if path not found
        }
      }
      
      return String(value);
    });
  }

  /**
   * Start processing automation queue
   */
  start(intervalMs: number = 10000) { // Default: every 10 seconds
    if (this.isRunning) {
      console.log('[AutomationQueueProcessor] Already running');
      return;
    }

    console.log(`[AutomationQueueProcessor] Starting with ${intervalMs}ms interval`);
    this.isRunning = true;

    this.intervalId = setInterval(async () => {
      await this.processQueue();
    }, intervalMs);

    // Process immediately on start
    this.processQueue();
  }

  /**
   * Stop processing
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    console.log('[AutomationQueueProcessor] Stopped');
  }

  /**
   * Process pending automation queue entries
   */
  private async processQueue() {
    if (!this.isRunning) return;

    try {
      const now = new Date();
      const pendingItems = await this.db.collection('automation_queue')
        .find({
          $or: [
            // Immediate items (no scheduledFor)
            {
              status: 'pending',
              scheduledFor: { $exists: false },
              attempts: { $lt: 3 },
              createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            },
            // Scheduled items that are now due
            {
              status: 'scheduled',
              scheduledFor: { $lte: now },
              attempts: { $lt: 3 }
            }
          ]
        })
        .limit(10)
        .toArray();

      // Update status of scheduled items to pending before processing
      if (pendingItems.length > 0) {
        const scheduledIds = pendingItems
          .filter(item => item.status === 'scheduled')
          .map(item => item._id);
        
        if (scheduledIds.length > 0) {
          await this.db.collection('automation_queue').updateMany(
            { _id: { $in: scheduledIds } },
            { $set: { status: 'pending' } }
          );
        }
      }

      if (pendingItems.length === 0) {
        return; // No pending items
      }

      console.log(`[AutomationQueueProcessor] Processing ${pendingItems.length} pending automations`);

      for (const item of pendingItems) {
        await this.processItem(item);
      }

    } catch (error) {
      console.error('[AutomationQueueProcessor] Error processing queue:', error);
    }
  }

  // Method removed - using /api/automations/execute endpoint instead

  /**
   * Process a single automation queue item
   */
  private async processItem(item: any) {
    try {
      // Mark as processing
      await this.db.collection('automation_queue').updateOne(
        { _id: item._id },
        {
          $set: {
            status: 'processing',
            processingStarted: new Date()
          },
          $inc: { attempts: 1 }
        }
      );

      // Call the execute endpoint
      const response = await axios.post(
        'https://lpai-backend-omega.vercel.app/api/automations/execute',
        {
          ruleId: item.ruleId,
          trigger: item.trigger,
          _id: item._id,
          action: item.action,        // ADD THIS LINE
          actionType: item.actionType // ADD THIS LINE
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (response.status !== 200) {
        throw new Error(`Execute failed: ${response.status}`);
      }

      // Mark as completed
      await this.db.collection('automation_queue').updateOne(
        { _id: item._id },
        {
          $set: {
            status: 'completed',
            processingCompleted: new Date()
          }
        }
      );

      console.log(`✅ [AutomationQueueProcessor] Successfully processed automation ${item._id}`);

    } catch (error: any) {
      console.error(`❌ [AutomationQueueProcessor] Failed to process item ${item._id}:`, error);
      
      const newStatus = (item.attempts || 0) >= 2 ? 'failed' : 'pending';
      
      await this.db.collection('automation_queue').updateOne(
        { _id: item._id },
        {
          $set: {
            status: newStatus,
            lastError: error?.message || 'Unknown error',
            processingCompleted: new Date()
          }
        }
      );
    }
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    const stats = await this.db.collection('automation_queue').aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    const total = await this.db.collection('automation_queue').countDocuments();
    
    return {
      total,
      byStatus: stats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {} as Record<string, number>),
      isRunning: this.isRunning
    };
  }
}
