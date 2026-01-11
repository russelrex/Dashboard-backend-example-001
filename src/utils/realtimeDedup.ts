import { Db } from 'mongodb';

/**
 * Check if we should publish a real-time event (with deduplication)
 * Prevents duplicate events within a time window
 */
export async function shouldPublishRealtimeEvent(
  db: Db,
  entityId: string,
  eventType: string,
  windowMs: number = 5000 // 5 second default window
): Promise<boolean> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);
  
  try {
    const result = await db.collection('realtime_events').insertOne({
      entityId,
      eventType,
      timestamp: now,
      ttl: new Date(now.getTime() + 60000) // Auto-delete after 1 minute
    });
    
    if (result.insertedId) {
      // Clean up old events outside the window
      await db.collection('realtime_events').deleteMany({
        entityId,
        eventType,
        timestamp: { $lt: windowStart }
      });
      return true;
    }
    return false;
  } catch (error) {
    // If duplicate key error, event was already published recently
    if ((error as any).code === 11000) {
      return false;
    }
    console.error('[RealtimeDedup] Error checking event:', error);
    return true; // Allow event on error to avoid blocking
  }
}

/**
 * Create indexes for the realtime_events collection
 * Run this during setup
 */
export async function createRealtimeEventIndexes(db: Db): Promise<void> {
  const collection = db.collection('realtime_events');
  
  // Unique index on entityId + eventType + recent timestamp
  await collection.createIndex(
    { entityId: 1, eventType: 1 },
    { 
      unique: true, 
      partialFilterExpression: { 
        timestamp: { $gte: new Date(Date.now() - 10000) } 
      } 
    }
  );
  
  // TTL index for automatic cleanup
  await collection.createIndex(
    { ttl: 1 },
    { expireAfterSeconds: 0 }
  );
}