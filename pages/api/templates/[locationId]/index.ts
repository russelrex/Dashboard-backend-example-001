// pages/api/templates/[locationId]/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import jwt from 'jsonwebtoken';

async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const authUser = await verifyAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { locationId } = req.query;
    if (!locationId || typeof locationId !== 'string') {
      return res.status(400).json({ error: 'Invalid locationId' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (req.method) {
      case 'GET': {
        // Get all templates for location (including global templates)
        const [globalTemplates, locationTemplates] = await Promise.all([
          db.collection('templates').find({ 
            isGlobal: true,
            isActive: { $ne: false }
          }).toArray(),
          db.collection('templates').find({ 
            locationId,
            isActive: { $ne: false }
          }).toArray()
        ]);

        // Combine and sort templates
        const allTemplates = [...globalTemplates, ...locationTemplates];
        allTemplates.sort((a, b) => {
          // Global templates first
          if (a.isGlobal && !b.isGlobal) return -1;
          if (!a.isGlobal && b.isGlobal) return 1;
          // Then by category and name
          if (a.category !== b.category) {
            return a.category.localeCompare(b.category);
          }
          return a.name.localeCompare(b.name);
        });

        return res.status(200).json(allTemplates);
      }

      case 'POST': {
        // Create new template
        const templateData = req.body;
        
        console.log('[API] Creating template:', {
          locationId,
          templateData,
          headers: req.headers
        });

        // Validate required fields
        if (!templateData.name || !templateData.category) {
          console.error('[API] Validation failed:', { 
            name: templateData.name, 
            category: templateData.category 
          });
          return res.status(400).json({ 
            error: 'Name and category are required' 
          });
        }

        // Ensure template has at least one tab
        if (!templateData.tabs || templateData.tabs.length === 0) {
          templateData.tabs = [{
            id: `tab_${Date.now()}`,
            title: 'Overview',
            icon: '📄',
            enabled: true,
            order: 1,
            blocks: []
          }];
        }

        const newTemplate = {
          ...templateData,
          locationId,
          isGlobal: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: authUser._id || authUser.userId,
          version: 1
        };

        const result = await db.collection('templates').insertOne(newTemplate);
        
        console.log('[API] Template created successfully:', {
          templateId: result.insertedId,
          templateName: newTemplate.name
        });
        
        return res.status(201).json({
          ...newTemplate,
          _id: result.insertedId
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('[Quote Templates API] Error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
}