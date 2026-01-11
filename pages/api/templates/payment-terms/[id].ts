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

    // ✅ ADD PATCH SUPPORT
    if (req.method === 'PATCH') {
      const { name, description, depositPercentage, depositType } = req.body;

      if (!name || !description) {
        return res.status(400).json({ 
          success: false, 
          error: 'Name and description are required' 
        });
      }

      // Update only LOCAL templates
      const result = await db.collection('paymentTermsTemplates').updateOne(
        {
          _id: new ObjectId(id as string),
          locationId: user.locationId,
          isLocation: true
        },
        {
          $set: {
            name: name.trim(),
            description: description.trim(),
            depositPercentage: depositPercentage || null,
            depositType: depositType || 'percentage',
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

    // ✅ EXISTING DELETE SUPPORT
    if (req.method === 'DELETE') {
      const result = await db.collection('paymentTermsTemplates').deleteOne({
        _id: new ObjectId(id as string),
        locationId: user.locationId,
        isLocation: true
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Template not found' 
        });
      }

      return res.status(200).json({ success: true });
    }

    // Method not allowed
    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ error: 'Method not allowed' });
    
  } catch (error) {
    console.error('[Payment Terms [id]] Error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}