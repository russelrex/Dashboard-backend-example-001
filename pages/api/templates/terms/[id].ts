/**
 * File: [id].ts
 * Purpose: Individual terms template operations (update/delete)
 * Author: LPai Team
 * Last Modified: 2025-10-14
 * Dependencies: MongoDB
 */

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token provided');
  
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as any;
  } catch {
    throw new Error('Invalid token');
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await verifyAuth(req);
    const { id } = req.query;
    
    const client = await clientPromise;
    const db = client.db(getDbName());

    // ✅ PATCH - Update LOCAL template only
    if (req.method === 'PATCH') {
      const { name, content, category } = req.body;

      if (!name || !content) {
        return res.status(400).json({ 
          success: false, 
          error: 'Name and content are required' 
        });
      }

      // ✅ Update only if template belongs to this location (not global)
      const result = await db.collection('termsTemplates').updateOne(
        {
          _id: new ObjectId(id as string),
          locationId: user.locationId  // Must match user's location (excludes global templates)
        },
        {
          $set: {
            name: name.trim(),
            content: content.trim(),
            category: category || 'terms',
            updatedAt: new Date()
          }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Template not found or cannot be edited' 
        });
      }

      return res.status(200).json({ 
        success: true, 
        message: 'Template updated successfully' 
      });
    }

    // ✅ DELETE - Remove LOCAL template only
    if (req.method === 'DELETE') {
      const result = await db.collection('termsTemplates').deleteOne({
        _id: new ObjectId(id as string),
        locationId: user.locationId  // Must match user's location (excludes global templates)
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Template not found or cannot be deleted' 
        });
      }

      return res.status(200).json({ 
        success: true,
        message: 'Template deleted successfully' 
      });
    }

    // Method not allowed
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
    
  } catch (error) {
    console.error('[Terms [id]] Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to process request' 
    });
  }
}