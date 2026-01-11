// pages/api/templates/[locationId]/copy/[globalTemplateId].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb'; // Note: 5 levels up!
import jwt from 'jsonwebtoken';
import cors from '../../../../../src/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { locationId, globalTemplateId } = req.query;

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Get the global template
    const globalTemplate = await db.collection('templates')
      .findOne({ _id: new ObjectId(globalTemplateId as string) });
    
    if (!globalTemplate) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Create location-specific copy
    const { _id, isGlobal, ...templateData } = globalTemplate;
    
    const newTemplate = {
      ...templateData,
      ...req.body,
      locationId: locationId as string,
      isGlobal: false,
      copiedFromId: _id,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await db.collection('templates').insertOne(newTemplate);
    
    const created = await db.collection('templates')
      .findOne({ _id: result.insertedId });
    
    res.status(201).json(created);
  } catch (error) {
    console.error('Error copying template:', error);
    res.status(500).json({ error: 'Failed to copy template' });
  }
}