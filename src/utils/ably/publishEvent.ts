// lpai-backend/src/utils/ably/publishEvent.ts
import Ably from 'ably';

// Initialize Ably client
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

export interface PublishEventOptions {
  locationId: string;
  userId?: string;
  entity: any;
  eventType: string;
  metadata?: any;
}

/**
 * Publish an event to Ably channels
 * Publishes to both location and user channels as appropriate
 */
export async function publishAblyEvent({
  locationId,
  userId,
  entity,
  eventType,
  metadata = {}
}: PublishEventOptions): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    const payload = {
      entity,
      userId,
      timestamp,
      ...metadata
    };

    // Always publish to location channel
    const locationChannel = ably.channels.get(`location:${locationId}`);
    await locationChannel.publish(eventType, payload);
    console.log(`[Ably] Published ${eventType} to location:${locationId}`);

    // If userId provided, also publish to user channel
    if (userId) {
      const userChannel = ably.channels.get(`user:${userId}`);
      await userChannel.publish(eventType, payload);
      console.log(`[Ably] Published ${eventType} to user:${userId}`);
    }
  } catch (error) {
    // Log error but don't throw - we don't want Ably failures to break the API
    console.error('[Ably] Failed to publish event:', error);
  }
}

/**
 * Publish assignment event specifically
 */
export async function publishAssignmentEvent({
  locationId,
  assignedUserId,
  entityType,
  entity
}: {
  locationId: string;
  assignedUserId: string;
  entityType: string;
  entity: any;
}): Promise<void> {
  try {
    const userChannel = ably.channels.get(`user:${assignedUserId}`);
    await userChannel.publish('assigned', {
      entityType,
      entity,
      timestamp: new Date().toISOString()
    });
    console.log(`[Ably] Published assignment to user:${assignedUserId}`);
  } catch (error) {
    console.error('[Ably] Failed to publish assignment:', error);
  }
}