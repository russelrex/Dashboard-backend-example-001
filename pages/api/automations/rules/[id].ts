/**
 * File: [id].ts
 * Purpose: Handle individual automation rule operations (GET/PUT/DELETE)
 * Author: LPai Team
 * Last Modified: 2025-09-04
 * Dependencies: MongoDB, JWT auth
 */

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../../src/lib/mongodb';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Auth check
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const { locationId, userId } = decoded;
    const { id } = req.query;

    const client = await clientPromise;
    const db = client.db();

    switch (req.method) {
      case 'GET':
        try {
          const rule = await db.collection('automation_rules').findOne(
            { _id: new ObjectId(id as string) }
          );
          if (!rule) {
            return res.status(404).json({ error: 'Automation rule not found' });
          }
          return res.json({ data: rule });
        } catch (error) {
          console.error('Failed to fetch automation rule:', error);
          return res.status(500).json({ error: 'Failed to fetch automation rule' });
        }

      case 'PUT':
        try {
          const updates = req.body;
          
          // Remove fields that shouldn't be updated
          delete updates._id;
          delete updates.id;
          delete updates.createdAt;
          delete updates.createdBy;
          
          // Add update timestamp
          updates.updatedAt = new Date();
          
          const result = await db.collection('automation_rules').updateOne(
            { _id: new ObjectId(id as string), locationId },
            { $set: updates }
          );
          
          if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Automation rule not found' });
          }
          
          return res.json({ success: true });
        } catch (error) {
          console.error('Failed to update automation rule:', error);
          return res.status(500).json({ error: 'Failed to update automation rule' });
        }

      case 'DELETE':
        try {
          const deleteResult = await db.collection('automation_rules').deleteOne(
            { _id: new ObjectId(id as string), locationId }
          );
          
          if (deleteResult.deletedCount === 0) {
            return res.status(404).json({ error: 'Automation rule not found' });
          }
          
          return res.json({ success: true });
        } catch (error) {
          console.error('Failed to delete automation rule:', error);
          return res.status(500).json({ error: 'Failed to delete automation rule' });
        }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}