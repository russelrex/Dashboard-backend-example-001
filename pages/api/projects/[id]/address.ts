// pages/api/projects/[id]/address.ts - NEW FILE
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { id } = req.query;
  const { locationId, useCustomAddress, address } = req.body;
  
  if (!id || !locationId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Verify project exists
    const project = await db.collection('projects').findOne({
      _id: new ObjectId(id as string),
      locationId: locationId
    });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Update address
    const updateData: any = {
      updatedAt: new Date()
    };
    
    if (useCustomAddress === false) {
      updateData.address = null; // Clear custom address
    } else if (address) {
      updateData.address = address; // Set custom address
    }
    
    const result = await db.collection('projects').findOneAndUpdate(
      { 
        _id: new ObjectId(id as string),
        locationId: locationId
      },
      { 
        $set: updateData,
        $push: {
          timeline: {
            id: new ObjectId().toString(),
            event: 'address_updated',
            description: useCustomAddress 
              ? 'Project address updated to custom location' 
              : 'Project address set to use contact address',
            timestamp: new Date().toISOString(),
            metadata: { useCustomAddress, address: address || null }
          }
        }
      },
      { returnDocument: 'after' }
    );
    
    return res.status(200).json(result.value);
    
  } catch (error) {
    console.error('❌ [API] Error updating address:', error);
    return res.status(500).json({ error: 'Failed to update address' });
  }
}