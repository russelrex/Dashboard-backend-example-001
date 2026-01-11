// src/utils/webhooks/processors/appointments.ts
// Updated to include OneSignal push notification integration
import { BaseProcessor } from './base';
import { QueueItem } from '../queueManager';
import { ObjectId, Db } from 'mongodb';
import { oneSignalService } from '../../../services/oneSignalService';
import Ably from 'ably';

// Initialize Ably
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);
import { shouldPublishRealtimeEvent } from '../../../utils/realtimeDedup';

export class AppointmentsProcessor extends BaseProcessor {
  constructor(db?: Db) {
    super({
      queueType: 'appointments',
      batchSize: 50,
      maxRuntime: 50000,
      processorName: 'AppointmentsProcessor'
    }, db);
  }

  /**
   * Process appointment webhooks
   */
  protected async processItem(item: QueueItem): Promise<void> {
    const { type, payload, webhookId } = item;

    // Track appointment processing start
    const appointmentStartTime = Date.now();

    switch (type) {
      case 'AppointmentCreate':
        await this.processAppointmentCreate(payload, webhookId);
        break;
        
      case 'AppointmentUpdate':
        await this.processAppointmentUpdate(payload, webhookId);
        break;
        
      case 'AppointmentDelete':
        await this.processAppointmentDelete(payload, webhookId);
        break;
        
      default:
        console.warn(`[AppointmentsProcessor] Unknown appointment type: ${type}`);
        throw new Error(`Unsupported appointment webhook type: ${type}`);
    }

    // Track appointment processing time
    const processingTime = Date.now() - appointmentStartTime;
    if (processingTime > 2000) {
      console.warn(`[AppointmentsProcessor] Slow appointment processing: ${processingTime}ms for ${type}`);
    }
  }

  /**
   * Process appointment create
   */
  private async processAppointmentCreate(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let appointmentData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      appointmentData = payload.webhookPayload;
      locationId = payload.locationId || appointmentData.locationId;
    } else {
      // Direct format
      appointmentData = payload;
      locationId = payload.locationId;
    }
    
    const { appointment } = appointmentData;
    
    if (!appointment?.id || !locationId) {
      console.error(`[AppointmentsProcessor] Missing required appointment data:`, {
        appointmentId: appointment?.id,
        locationId: !!locationId,
        webhookId
      });
      throw new Error('Missing required appointment data');
    }
    
    console.log(`[AppointmentsProcessor] Creating appointment ${appointment.id}`);
    
    // Find contact if exists (only need for project timeline updates)
    let contactId = null;
    if (appointment.contactId) {
      const contact = await this.db.collection('contacts').findOne(
        {
          ghlContactId: appointment.contactId,
          locationId: locationId
        },
        {
          projection: { _id: 1 }
        }
      );
      if (contact) {
        contactId = contact._id.toString();
      }
    }
    
    // Start session for atomic operations
    const session = this.client.startSession();
    
    let savedAppointment;
    
    try {
      await session.withTransaction(async () => {
        const appointmentDoc = {
          ghlAppointmentId: appointment.id,
          locationId,
          contactId,
          ghlContactId: appointment.contactId,
          calendarId: appointment.calendarId,
          groupId: appointment.groupId,
          appointmentStatus: appointment.appointmentStatus || appointment.status,
          title: appointment.title || 'Appointment',
          assignedUserId: appointment.assignedUserId,
          users: appointment.users || [],
          notes: appointment.notes || '',
          source: appointment.source || 'webhook',
          startTime: appointment.startTime ? new Date(appointment.startTime) : null,
          endTime: appointment.endTime ? new Date(appointment.endTime) : null,
          dateAdded: appointment.dateAdded ? new Date(appointment.dateAdded) : new Date(),
          address: appointment.address || appointment.location || '',
          timezone: appointment.timezone || appointment.selectedTimezone || 'UTC',
          lastWebhookUpdate: new Date(),
          updatedAt: new Date(),
          processedBy: 'queue',
          webhookId
        };

        const result = await this.db.collection('appointments').findOneAndUpdate(
          { ghlAppointmentId: appointment.id, locationId },
          {
            $set: appointmentDoc,
            $setOnInsert: {
              _id: new ObjectId(),
              createdAt: new Date(),
              createdByWebhook: webhookId
            }
          },
          { 
            upsert: true, 
            session,
            returnDocument: 'after'
          }
        );

        savedAppointment = result.value || result;
        
        // Update project timeline if exists
        if (contactId) {
          const project = await this.db.collection('projects').findOne(
            {
              contactId: contactId,
              locationId: locationId,
              status: { $in: ['open', 'quoted', 'won', 'in_progress'] }
            },
            {
              projection: { _id: 1 },
              session
            }
          );
          
          if (project) {
            await this.db.collection('projects').updateOne(
              { _id: project._id },
              {
                $push: {
                  timeline: {
                    id: new ObjectId().toString(),
                    event: 'appointment_scheduled',
                    description: `${appointment.title || 'Appointment'} scheduled`,
                    timestamp: new Date().toISOString(),
                    metadata: {
                      appointmentId: appointment.id,
                      startTime: appointment.startTime,
                      webhookId
                    }
                  }
                }
              },
              { session }
            );
          }
        }
      });
    } finally {
      await session.endSession();
    }

    // Send notifications OUTSIDE the transaction
    if (savedAppointment) {
      try {
        // 1. Send push notification to assigned technician
        if (appointment.assignedUserId) {
          await oneSignalService.sendAppointmentNotification(
            appointment.assignedUserId,
            savedAppointment,
            'created'
          );
          console.log('✅ [OneSignal] Sent appointment notification to technician:', appointment.assignedUserId);

          // Also send via Ably for real-time update
          const channel = ably.channels.get(`user:${appointment.assignedUserId}`);
          await channel.publish('appointment.created', {
            appointment: savedAppointment,
            timestamp: new Date().toISOString()
          });
          console.log('[Ably] Published appointment.created to user:', appointment.assignedUserId);
        }

        // 2. No customer notifications needed (customers don't use the app)

        // 3. Broadcast to location for calendar updates
        const locationChannel = ably.channels.get(`location:${locationId}`);
        await locationChannel.publish('appointments.changed', {
          action: 'created',
          appointmentId: savedAppointment._id.toString(),
          timestamp: new Date().toISOString()
        });
        console.log('[Ably] Broadcast appointment change to location:', locationId);

      } catch (notificationError) {
        console.error('❌ [Notification] Failed to send appointment notifications:', notificationError);
        // Don't throw - notifications shouldn't break the flow
      }
    }
  }

  /**
   * Process appointment update
   */
  private async processAppointmentUpdate(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let appointmentData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      appointmentData = payload.webhookPayload;
      locationId = payload.locationId || appointmentData.locationId;
    } else {
      // Direct format
      appointmentData = payload;
      locationId = payload.locationId;
    }
    
    const { appointment } = appointmentData;
    
    if (!appointment?.id || !locationId) {
      console.error(`[AppointmentsProcessor] Missing required appointment data:`, {
        appointmentId: appointment?.id,
        locationId: !!locationId,
        webhookId
      });
      throw new Error('Missing required appointment data');
    }
    
    console.log(`[AppointmentsProcessor] Updating appointment ${appointment.id}`);
    
    // Get the existing appointment to check for changes
    const existingAppointment = await this.db.collection('appointments').findOne({
      ghlAppointmentId: appointment.id,
      locationId
    });
    
    const updateData: any = {
      lastWebhookUpdate: new Date(),
      updatedAt: new Date(),
      processedBy: 'queue',
      webhookId
    };
    
    // Update fields that might change
    const fieldsToUpdate = [
      'title', 'assignedUserId', 'users',
      'notes', 'source', 'groupId', 'timezone'
    ];
    
    fieldsToUpdate.forEach(field => {
      if (appointment[field] !== undefined) {
        updateData[field] = appointment[field];
      }
    });
    
    // Handle status fields (can be in different places)
    if (appointment.appointmentStatus !== undefined) {
      updateData.appointmentStatus = appointment.appointmentStatus;
    } else if (appointment.status !== undefined) {
      updateData.appointmentStatus = appointment.status;
    }
    
    // Handle address/location field
    if (appointment.address !== undefined) {
      updateData.address = appointment.address;
    } else if (appointment.location !== undefined) {
      updateData.address = appointment.location;
    }
    
    // Handle date fields
    if (appointment.startTime) updateData.startTime = new Date(appointment.startTime);
    if (appointment.endTime) updateData.endTime = new Date(appointment.endTime);
    if (appointment.dateAdded) updateData.dateAdded = new Date(appointment.dateAdded);
    
    const result = await this.db.collection('appointments').updateOne(
      { ghlAppointmentId: appointment.id, locationId },
      { $set: updateData }
    );
    
    console.log(`[AppointmentsProcessor] Update result:`, {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      fieldsUpdated: Object.keys(updateData).length
    });
    
    if (result.matchedCount === 0) {
      // Appointment doesn't exist, create it
      console.log(`[AppointmentsProcessor] Appointment not found, creating new one`);
      await this.processAppointmentCreate(payload, webhookId);
    } else if (result.modifiedCount > 0 && existingAppointment) {
      // Send update notifications
      try {
        // Check if assigned user changed
        if (appointment.assignedUserId && appointment.assignedUserId !== existingAppointment.assignedUserId) {
          // Notify new assignee
          await oneSignalService.sendAppointmentNotification(
            appointment.assignedUserId,
            { ...existingAppointment, ...updateData },
            'assigned'
          );
          console.log('✅ [OneSignal] Sent assignment notification to:', appointment.assignedUserId);
        }

        // Check if time changed
        const timeChanged = (updateData.startTime && 
          new Date(updateData.startTime).getTime() !== new Date(existingAppointment.startTime).getTime());

        if (timeChanged) {
          // Notify assigned user about time change
          if (existingAppointment.assignedUserId) {
            await oneSignalService.sendAppointmentNotification(
              existingAppointment.assignedUserId,
              { ...existingAppointment, ...updateData },
              'rescheduled'
            );
          }

          // No customer notifications needed (customers don't use the app)
        }

        // Broadcast update via Ably
        const locationChannel = ably.channels.get(`location:${locationId}`);
        await locationChannel.publish('appointments.changed', {
          action: 'updated',
          appointmentId: existingAppointment._id.toString(),
          changes: updateData,
          timestamp: new Date().toISOString()
        });

      } catch (notificationError) {
        console.error('❌ [Notification] Failed to send update notifications:', notificationError);
      }
    }

    // Publish real-time event with deduplication
    try {
      const shouldPublish = await shouldPublishRealtimeEvent(
        this.db,
        appointment.id,
        'appointment-updated'
      );
      
      if (shouldPublish) {
        const updatedAppointment = await this.db.collection('appointments').findOne({
          ghlAppointmentId: appointment.id
        });
        
        if (updatedAppointment) {
          // Publish to assigned user
          if (appointment.assignedUserId) {
            await ably.channels.get(`user:${appointment.assignedUserId}`).publish('appointment-updated', {
              appointment: updatedAppointment,
              timestamp: new Date().toISOString()
            });
          }
          
          // Publish to location channel
          await ably.channels.get(`location:${locationId}`).publish('appointments:changed', {
            action: 'updated',
            appointment: updatedAppointment,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (ablyError) {
              console.error('[Ably] Failed to publish appointment-updated:', ablyError);
    }
  }

  /**
   * Process appointment delete
   */
  private async processAppointmentDelete(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let appointmentData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      appointmentData = payload.webhookPayload;
      locationId = payload.locationId || appointmentData.locationId;
    } else {
      // Direct format
      appointmentData = payload;
      locationId = payload.locationId;
    }
    
    const { appointment } = appointmentData;
    
    if (!appointment?.id || !locationId) {
      console.error(`[AppointmentsProcessor] Missing required appointment data:`, {
        appointmentId: appointment?.id,
        locationId: !!locationId,
        webhookId
      });
      throw new Error('Missing required appointment data');
    }
    
    console.log(`[AppointmentsProcessor] Deleting appointment ${appointment.id}`);
    
    // Get existing appointment before marking as deleted
    const existingAppointment = await this.db.collection('appointments').findOne({
      ghlAppointmentId: appointment.id,
      locationId
    });
    
    const result = await this.db.collection('appointments').updateOne(
      { ghlAppointmentId: appointment.id, locationId },
      { 
        $set: { 
          deleted: true,
          deletedAt: new Date(),
          deletedByWebhook: webhookId,
          appointmentStatus: 'cancelled',
          processedBy: 'queue'
        } 
      }
    );
    
    console.log(`[AppointmentsProcessor] Delete result:`, {
      matched: result.matchedCount,
      modified: result.modifiedCount
    });
    
    // Send cancellation notifications
    if (existingAppointment && result.modifiedCount > 0) {
      try {
        // Notify assigned user
        if (existingAppointment.assignedUserId) {
          await oneSignalService.sendAppointmentNotification(
            existingAppointment.assignedUserId,
            existingAppointment,
            'cancelled'
          );
          console.log('✅ [OneSignal] Sent cancellation notification to:', existingAppointment.assignedUserId);
        }

        // No customer notifications needed (customers don't use the app)

        // Broadcast cancellation via Ably
        const locationChannel = ably.channels.get(`location:${locationId}`);
        await locationChannel.publish('appointments.changed', {
          action: 'cancelled',
          appointmentId: existingAppointment._id.toString(),
          timestamp: new Date().toISOString()
        });

      } catch (notificationError) {
        console.error('❌ [Notification] Failed to send cancellation notifications:', notificationError);
      }
    }
    
    // Update project timeline if appointment was linked to a contact
    if (appointment?.contactId) {
      const project = await this.db.collection('projects').findOne({
        contactId: appointment.contactId,
        locationId: locationId,
        status: { $in: ['open', 'quoted', 'won', 'in_progress'] }
      });
      
      if (project) {
        await this.db.collection('projects').updateOne(
          { _id: project._id },
          {
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'appointment_cancelled',
                description: `${existingAppointment?.title || 'Appointment'} cancelled`,
                timestamp: new Date().toISOString(),
                metadata: {
                  appointmentId: appointment.id,
                  webhookId
                }
              }
            }
          }
        );
      }
    }
  }

  /**
   * Send appointment reminders (to be called by cron job)
   */
  static async sendAppointmentReminders(db: Db): Promise<void> {
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    
    console.log(`[AppointmentReminders] Checking for appointments between ${now.toISOString()} and ${oneHourFromNow.toISOString()}`);
    
    // Find appointments starting in the next hour
    const upcomingAppointments = await db.collection('appointments').find({
      startTime: {
        $gte: now,
        $lte: oneHourFromNow
      },
      appointmentStatus: { $nin: ['cancelled', 'completed'] },
      reminderSent: { $ne: true },
      deleted: { $ne: true }
    }).toArray();
    
    console.log(`[AppointmentReminders] Found ${upcomingAppointments.length} appointments needing reminders`);
    
    for (const appointment of upcomingAppointments) {
      try {
        // Send reminder to technician
        if (appointment.assignedUserId) {
          await oneSignalService.sendAppointmentNotification(
            appointment.assignedUserId,
            appointment,
            'reminder'
          );
          console.log(`✅ [AppointmentReminders] Sent reminder for appointment ${appointment._id} to user ${appointment.assignedUserId}`);
        }
        
        // No customer reminders needed (customers don't use the app)
        
        // Mark reminder as sent
        await db.collection('appointments').updateOne(
          { _id: appointment._id },
          { $set: { reminderSent: true, reminderSentAt: new Date() } }
        );
        
      } catch (error) {
        console.error(`❌ [AppointmentReminders] Failed to send reminder for appointment ${appointment._id}:`, error);
      }
    }
    
    console.log(`[AppointmentReminders] Completed processing ${upcomingAppointments.length} reminders`);
  }
}