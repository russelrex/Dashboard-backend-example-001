// `src/services/eventBus.ts`:
import { EventEmitter } from 'events';
import { Db } from 'mongodb';

class EventBus extends EventEmitter {
  private static instance: EventBus;
  private db: Db | null = null;

  private constructor() {
    super();
    this.setMaxListeners(100); // Increase for scale
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  setDb(db: Db) {
    this.db = db;
  }

  // Emit domain events
  emitContactCreated(contact: any) {
    this.emit('contact.created', { 
      type: 'contact.created',
      data: contact,
      timestamp: new Date()
    });
  }

  emitContactUpdated(contact: any, changes: any) {
    this.emit('contact.updated', { 
      type: 'contact.updated',
      data: contact,
      changes,
      timestamp: new Date()
    });
  }

  emitProjectStageChanged(project: any, oldStage: string, newStage: string) {
    this.emit('project.stage.changed', {
      type: 'project.stage.changed',
      data: project,
      oldStage,
      newStage,
      timestamp: new Date()
    });
  }
}

export const eventBus = EventBus.getInstance();