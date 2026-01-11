// File: pages/api/email/templates.ts
// Created: December 2024
// Description: API endpoints for managing email templates

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import cors from '@/lib/cors';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';

function extractVariables(content: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const variables = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    variables.push(match[1].trim());
  }
  return [...new Set(variables)];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  await cors(req, res);

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
          const templates = await db.collection('email_templates')
            .find({ 
              locationId,
              isActive: true 
            })
            .sort({ category: 1, name: 1 })
            .toArray();
          
          return res.json({ templates });
        } catch (error) {
          console.error('Failed to fetch email templates:', error);
          return res.status(500).json({ error: 'Failed to fetch templates' });
        }

      case 'POST':
        try {
          const template = {
            ...req.body,
            locationId,
            createdBy: userId,
            createdAt: new Date(),
            updatedAt: new Date(),
            isActive: true,
            variables: extractVariables(req.body.content + ' ' + (req.body.subject || ''))
          };
          
          const result = await db.collection('email_templates').insertOne(template);
          return res.json({ 
            success: true, 
            id: result.insertedId,
            template: { ...template, _id: result.insertedId }
          });
        } catch (error) {
          console.error('Failed to create email template:', error);
          return res.status(500).json({ error: 'Failed to create template' });
        }

      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}