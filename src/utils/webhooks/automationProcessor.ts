// src/utils/webhooks/automationProcessor.ts
import { Db, ObjectId } from 'mongodb';
import Ably from 'ably';
// import { shouldPublishRealtimeEvent } from '../realtimeDedup';
import { oneSignalService } from '../../services/oneSignalService';

const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

// Simple deduplication function - replace with actual import when available
const shouldPublishRealtimeEvent = async (db: Db, id: string, eventType: string): Promise<boolean> => {
  // For now, always return true to allow execution
  // TODO: Implement proper deduplication logic
  return true;
};

export class AutomationProcessor {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async processAutomationTrigger(trigger: {
    automationId: string;
    locationId: string;
    triggerType: string;
    entityId: string;
    entityType: string;
    data: any;
  }): Promise<void> {
    const { automationId, locationId, triggerType, entityId, entityType, data } = trigger;

    // Check if we should publish this event
    const shouldPublish = await shouldPublishRealtimeEvent(
      this.db,
      `${automationId}-${entityId}`,
      'automation:triggered'
    );

    if (!shouldPublish) {
      console.log('[Automation] Skipping duplicate trigger event');
      return;
    }

    // Get automation details
    const automation = await this.db.collection('automations').findOne({
      _id: new ObjectId(automationId),
      locationId
    });

    if (!automation) {
      console.error('[Automation] Automation not found:', automationId);
      return;
    }

    // Record execution
    const execution = {
      automationId,
      locationId,
      triggerType,
      entityId,
      entityType,
      startedAt: new Date(),
      status: 'running',
      actions: [],
      data
    };

    const result = await this.db.collection('automation_executions').insertOne(execution);

    // Publish real-time event
    await ably.channels.get(`location:${locationId}`).publish('automation:triggered', {
      automationId,
      executionId: result.insertedId,
      name: automation.name,
      triggerType,
      entityType,
      timestamp: new Date().toISOString()
    });

    // Send push notification to automation owner
    if (automation.createdBy) {
      await oneSignalService.sendToUsers(automation.createdBy, {
        headings: { en: '🤖 Automation Triggered' },
        contents: { en: `"${automation.name}" started for ${entityType}` },
        data: {
          type: 'automation',
          automationId,
          executionId: result.insertedId.toString(),
          action: 'view_execution'
        }
      });
    }

    // Execute automation actions
    try {
      await this.executeAutomation(automation, execution, entityId);
    } catch (error: any) {
      console.error('[Automation] Execution failed:', error);
      await this.completeAutomation(result.insertedId, 'failed', error.message);
    }
  }

  // Add this method that contacts processor expects
  async processAutomationTriggers(params: {
    eventType: string;
    locationId: string;
    entityType: string;
    entityId: string;
    data: any;
  }): Promise<void> {
    // For now, just log that we received the trigger
    console.log(`[AutomationProcessor] Processing trigger:`, {
      eventType: params.eventType,
      locationId: params.locationId,
      entityType: params.entityType,
      entityId: params.entityId
    });

    // TODO: Implement actual automation trigger logic based on event type
    // This is where you'd query automation rules and queue them for processing
  }

  private async executeAutomation(automation: any, execution: any, entityId: string): Promise<void> {
    const { actions } = automation;
    const completedActions = [];

    for (const action of actions) {
      try {
        console.log(`[Automation] Executing action: ${action.type}`);
        
        switch (action.type) {
          case 'send_sms':
            // Execute SMS action
            await this.executeSmsAction(action, entityId);
            break;
            
          case 'update_field':
            // Update entity field
            await this.executeFieldUpdate(action, entityId);
            break;
            
          case 'create_task':
            // Create task
            await this.executeCreateTask(action, entityId);
            break;
            
          case 'assign_user':
            // Assign to user
            await this.executeAssignUser(action, entityId);
            break;
            
          case 'add_tag':
            // Add tag
            await this.executeAddTag(action, entityId);
            break;
            
          case 'webhook':
            // Call webhook
            await this.executeWebhook(action, entityId);
            break;
        }

        completedActions.push({
          type: action.type,
          status: 'completed',
          completedAt: new Date()
        });

      } catch (error: any) {
        console.error(`[Automation] Action failed: ${action.type}`, error);
        completedActions.push({
          type: action.type,
          status: 'failed',
          error: error.message,
          completedAt: new Date()
        });
      }
    }

    // Complete automation
    await this.completeAutomation(execution._id, 'completed', undefined, completedActions);
  }

  private async completeAutomation(
    executionId: any,
    status: 'completed' | 'failed',
    error?: string,
    actions?: any[]
  ): Promise<void> {
    const update: any = {
      status,
      completedAt: new Date()
    };

    if (error) update.error = error;
    if (actions) update.actions = actions;

    await this.db.collection('automation_executions').updateOne(
      { _id: executionId },
      { $set: update }
    );

    // Get execution details for notification
    const execution = await this.db.collection('automation_executions').findOne({ _id: executionId });
    if (!execution) {
      console.error('[Automation] Execution not found for completion:', executionId);
      return;
    }

    const automation = await this.db.collection('automations').findOne({ _id: execution.automationId });
    if (!automation) {
      console.error('[Automation] Automation not found for completion:', execution.automationId);
      return;
    }

    // Publish completion event
    await ably.channels.get(`location:${execution.locationId}`).publish('automation:completed', {
      automationId: execution.automationId,
      executionId,
      status,
      name: automation.name,
      duration: new Date().getTime() - execution.startedAt.getTime(),
      timestamp: new Date().toISOString()
    });

    // Send completion notification
    if (automation.createdBy && status === 'failed') {
      await oneSignalService.sendToUsers(automation.createdBy, {
        headings: { en: '⚠️ Automation Failed' },
        contents: { en: `"${automation.name}" failed: ${error || 'Unknown error'}` },
        data: {
          type: 'automation',
          automationId: execution.automationId,
          executionId: executionId.toString(),
          action: 'view_execution'
        }
      });
    }
  }

  // Implementation of specific action types
  private async executeSmsAction(action: any, entityId: string): Promise<void> {
    // Implementation here
  }

  private async executeFieldUpdate(action: any, entityId: string): Promise<void> {
    // Implementation here
  }

  private async executeCreateTask(action: any, entityId: string): Promise<void> {
    // Implementation here
  }

  private async executeAssignUser(action: any, entityId: string): Promise<void> {
    // Implementation here
  }

  private async executeAddTag(action: any, entityId: string): Promise<void> {
    // Implementation here
  }

  private async executeWebhook(action: any, entityId: string): Promise<void> {
    // Implementation here
  }
}

// Singleton instance
let processorInstance: AutomationProcessor | null = null;

export function getAutomationProcessor(db?: Db): AutomationProcessor {
  if (!processorInstance && db) {
    processorInstance = new AutomationProcessor(db);
  }
  if (!processorInstance) {
    throw new Error('AutomationProcessor not initialized. Please provide a database connection.');
  }
  return processorInstance;
} 