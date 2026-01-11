// pages/api/templates/[locationId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import cors from '../../../src/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  const { locationId } = req.query;

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    switch (req.method) {
      case 'GET':
        // Get both location and global templates
        const [locationTemplates, globalTemplates] = await Promise.all([
          db.collection('templates')
            .find({ locationId: locationId as string })
            .toArray(),
          db.collection('templates')
            .find({ isGlobal: true })
            .toArray()
        ]);
        
        // Return in the expected format
        res.status(200).json({
          locationTemplates: locationTemplates || [],
          globalTemplates: globalTemplates || []
        });
        break;
        
      case 'POST':
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
        
      case 'PUT':
        const { templateId, ...updateData } = req.body;
        
        const putResult = await db.collection('templates')
          .updateOne(
            { _id: new ObjectId(templateId) },
            { 
              $set: { 
                ...updateData,
                updatedAt: new Date()
              } 
            }
          );
        
        res.status(200).json({ success: true });
        break;
        
      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT']);
        res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error handling template request:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
}