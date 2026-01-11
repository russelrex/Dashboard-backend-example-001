import * as Ably from 'ably';

class RealtimeService {
  private ablyClient: Ably.Rest;
  private failureCount = 0;
  private lastFailureTime = 0;
  private circuitBreakerThreshold = 5;
  private circuitBreakerTimeout = 30000;

  constructor() {
    if (!process.env.ABLY_API_KEY) {
      throw new Error('ABLY_API_KEY is not defined');
    }
    
    this.ablyClient = new Ably.Rest({
      key: process.env.ABLY_API_KEY
    });
  }

  private isCircuitOpen(): boolean {
    if (this.failureCount >= this.circuitBreakerThreshold) {
      if (Date.now() - this.lastFailureTime < this.circuitBreakerTimeout) {
        return true;
      } else {
        this.failureCount = 0;
      }
    }
    return false;
  }

  async publishMessage(roomId: string, event: {
    type: 'new_message' | 'typing' | 'user_joined' | 'user_left' | 'message_updated' | 'message_deleted' | 'messages_read';
    data: any;
    userId: string;
    timestamp: string;
  }) {
    if (this.isCircuitOpen()) {
      console.warn('Circuit breaker open, skipping real-time publish');
      return;
    }

    const channelName = `chat:${roomId}`;
    const channel = this.ablyClient.channels.get(channelName);
    
    try {
      await channel.publish('chat-event', {
        ...event,
        roomId
      });
      console.log(`Published ${event.type} event to ${channelName}`);
      this.failureCount = 0;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      console.error('Failed to publish to Ably:', error);
      throw error;
    }
  }

  async publishToRoom(roomId: string, eventType: string, data: any, userId?: string) {
    await this.publishMessage(roomId, {
      type: eventType as any,
      data,
      userId: userId || 'system',
      timestamp: new Date().toISOString()
    });
  }

  async publishNewMessage(roomId: string, message: any, userId: string) {
    await this.publishMessage(roomId, {
      type: 'new_message',
      data: message,
      userId,
      timestamp: new Date().toISOString()
    });
  }

  async publishMessagesRead(roomId: string, userId: string, messageIds: string[], readAt: Date) {
    await this.publishMessage(roomId, {
      type: 'messages_read',
      data: {
        userId,
        roomId,
        messageIds,
        readAt: readAt.toISOString()
      },
      userId,
      timestamp: new Date().toISOString()
    });
  }

  async publishTypingIndicator(roomId: string, userId: string, userName: string, isTyping: boolean) {
    await this.publishMessage(roomId, {
      type: 'typing',
      data: { isTyping, userName },
      userId,
      timestamp: new Date().toISOString()
    });
  }

  async publishUserPresence(roomId: string, userId: string, userName: string, type: 'user_joined' | 'user_left') {
    await this.publishMessage(roomId, {
      type,
      data: { userId, userName },
      userId,
      timestamp: new Date().toISOString()
    });
  }

  async publishMessageUpdate(roomId: string, message: any, userId: string) {
    await this.publishMessage(roomId, {
      type: 'message_updated',
      data: message,
      userId,
      timestamp: new Date().toISOString()
    });
  }

  async publishMessageDeletion(roomId: string, messageId: string, userId: string) {
    await this.publishMessage(roomId, {
      type: 'message_deleted',
      data: { messageId },
      userId,
      timestamp: new Date().toISOString()
    });
  }
}

export const realtimeService = new RealtimeService(); 