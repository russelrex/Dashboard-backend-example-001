// File: pages/api/automations/rules/index.ts
// Created: December 2024
// Description: API endpoints for managing automation rules

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
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

    const client = await clientPromise;
    const db = client.db();

    switch (req.method) {
      case 'GET':
        try {
          const { pipelineId, locationId: queryLocationId, isTemplate, hideCalendarAutomations } = req.query;
          
          let query: any = {};
          
          // Handle template queries
          if (queryLocationId === 'TEMPLATE' && isTemplate === 'true') {
            query = { locationId: 'TEMPLATE', isTemplate: true };
          } else {
            // Regular location-based queries
            query = { locationId };
            if (pipelineId) query.pipelineId = pipelineId;
          }

          // ✅ NEW: Hide calendar automations from main automations screen
          if (hideCalendarAutomations === 'true') {
            query.$or = [
              { isCalendarAutomation: { $ne: true } },
              { isCalendarAutomation: { $exists: false } }
            ];
          }
          
          const rules = await db.collection('automation_rules')
            .find(query)
            .toArray();
          return res.json({ data: rules });
        } catch (error) {
          console.error('Failed to fetch automation rules:', error);
          return res.status(500).json({ error: 'Failed to fetch automation rules' });
        }

      case 'POST':
        try {
          const body = req.body;
          
          // Process actions to ensure delay configuration is valid
          if (body.actions && Array.isArray(body.actions)) {
            body.actions = body.actions.map((action: any, index: number) => {
              // Ensure each action has an ID
              if (!action.id) {
                action.id = `action_${Date.now()}_${index}`;
              }
              
              // Validate delay configuration if present
              if (action.config?.delay) {
                if (!action.config.delay.amount || !action.config.delay.unit) {
                  delete action.config.delay; // Remove invalid delay config
                }
              }
              
              return action;
            });
          }

          // Set default execution stats
          body.executionStats = {
            executionCount: 0,
            successCount: 0,
            failureCount: 0,
            lastExecuted: null
          };
          
          const rule = {
            ...body,
            locationId,
            createdBy: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true
          };
          
          const result = await db.collection('automation_rules').insertOne(rule);
          return res.json({ success: true, id: result.insertedId });
        } catch (error) {
          console.error('Failed to create automation rule:', error);
          return res.status(500).json({ error: 'Failed to create automation rule' });
        }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}