/**
 * File: counterGenerator.ts
 * Purpose: Generate unique sequential numbers for quotes, invoices, etc.
 * Author: LPai Team
 * Last Modified: 2025-09-17
 * Dependencies: MongoDB
 */

import { Db } from 'mongodb';

export async function generateQuoteNumber(db: Db, locationId: string): Promise<string> {
  const year = new Date().getFullYear();
  const counterKey = `${locationId}-quote-${year}`;
  
  const counter = await db.collection('counters').findOneAndUpdate(
    { _id: counterKey },
    { 
      $inc: { seq: 1 },
      $setOnInsert: { 
        createdAt: new Date(),
        description: `Quote sequence counter for location ${locationId} in ${year}`
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  const sequenceNumber = String(counter.seq || 1).padStart(3, '0');
  return `Q-${year}-${sequenceNumber}`;
}

export async function generateInvoiceNumber(db: Db, locationId: string, type: string = 'invoice'): Promise<string> {
  const year = new Date().getFullYear();
  const counterKey = `${locationId}-${type}-${year}`;
  
  const counter = await db.collection('counters').findOneAndUpdate(
    { _id: counterKey },
    { 
      $inc: { seq: 1 },
      $setOnInsert: { 
        createdAt: new Date(),
        description: `${type} sequence counter for location ${locationId} in ${year}`
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  const sequenceNumber = String(counter.seq || 1).padStart(3, '0');
  const prefix = type === 'deposit' ? 'DEP' : type === 'progress' ? 'PROG' : 'INV';
  return `${prefix}-${year}-${sequenceNumber}`;
}
