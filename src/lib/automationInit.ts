// src/lib/automationInit.ts
import { Db } from 'mongodb';
import { eventBus } from '../services/eventBus';
import { AutomationEventListener } from '../services/automationEventListener';
import { AutomationQueueProcessor } from '../services/automationQueueProcessor';

let isInitialized = false;
let automationListener: AutomationEventListener | null = null;
let automationQueueProcessor: AutomationQueueProcessor | null = null;

export async function initializeAutomationSystem(db: Db) {
  // Prevent multiple initializations in serverless environment
  if (isInitialized) {
    return;
  }

  try {
    // Initialize event bus with database
    eventBus.setDb(db);
    
    // Create and start automation listener
    automationListener = new AutomationEventListener(db);
    
    // ✅ INITIALIZE AUTOMATION QUEUE PROCESSOR
    automationQueueProcessor = new AutomationQueueProcessor(db);
    automationQueueProcessor.start(10000); // Process every 10 seconds
    
    isInitialized = true;
    console.log('✅ Automation system initialized with queue processor');
  } catch (error) {
    console.error('❌ Failed to initialize automation system:', error);
    // Don't throw - let the system continue without automations
  }
}

// Optional: Export for cleanup if needed
export function getAutomationListener() {
  return automationListener;
}

export function getAutomationQueueProcessor() {
  return automationQueueProcessor;
}