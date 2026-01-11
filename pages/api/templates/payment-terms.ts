/**
 * File: payment-terms.ts
 * Purpose: API endpoint for Payment Terms templates
 * Author: LPai Team
 * Last Modified: 2025-01-27
 * Dependencies: MongoDB
 */

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import cors from '../../../src/lib/cors';

// Auth middleware
async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  try {
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const { locationId } = user;
    
    if (req.method === 'GET') {
      return await getPaymentTermsTemplates(req, res, locationId);
    } else if (req.method === 'POST') {
      return await createPaymentTermsTemplate(req, res, locationId, user._id);
    } else if (req.method === 'DELETE') {
      return await deletePaymentTermsTemplate(req, res, locationId);
    } else {
      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('[Payment Terms Templates API] Error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getPaymentTermsTemplates(req: NextApiRequest, res: NextApiResponse, locationId: string) {
  const client = await clientPromise;
  const db = client.db(getDbName());

  const templates = await db.collection('paymentTermsTemplates').find({
    $and: [
      { isActive: true },
      {
        $or: [
          { locationId: locationId },
          { locationId: 'global' }
        ]
      }
    ]
  }).sort({ locationId: 1, name: 1 }).toArray();

  return res.status(200).json({ 
    success: true, 
    data: templates 
  });
}

// Update the create function to include depositType
async function createPaymentTermsTemplate(req: NextApiRequest, res: NextApiResponse, locationId: string, userId: string) {
  const { name, description, depositPercentage, depositType } = req.body;

  if (!name || !description) {
    return res.status(400).json({ success: false, error: 'Name and description are required' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  const template = {
    locationId,
    name,
    description,
    depositPercentage: depositPercentage || null,
    depositType: depositType || 'percentage',
    isLocation: true,  // Mark as location-specific
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: userId
  };

  const result = await db.collection('paymentTermsTemplates').insertOne(template);

  return res.status(201).json({ 
    success: true, 
    data: { _id: result.insertedId, ...template }
  });
}

// Add DELETE function
async function deletePaymentTermsTemplate(req: NextApiRequest, res: NextApiResponse, locationId: string) {
  const { id } = req.query;
  
  if (!id) {
    return res.status(400).json({ success: false, error: 'Template ID is required' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  // Only allow deleting location-specific templates
  const result = await db.collection('paymentTermsTemplates').deleteOne({
    _id: new ObjectId(id as string),
    locationId: locationId,
    isLocation: true
  });

  if (result.deletedCount === 0) {
    return res.status(404).json({ success: false, error: 'Template not found or cannot be deleted' });
  }

  return res.status(200).json({ success: true, message: 'Template deleted successfully' });
}