// lpai-backend/pages/api/projects/[id]/photos/get-upload-url.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const { locationId } = req.body;
  
  if (!id || !locationId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Verify project exists
    const project = await db.collection('projects').findOne({
      _id: new ObjectId(id as string),
      locationId
    });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // For v1 direct upload, we need to use URL parameters
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/images/v1/direct_upload`);
    url.searchParams.append('requireSignedURLs', 'false');
    
    const cfResponse = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CF_API_TOKEN}`
      }
    });
    
    const cfData = await cfResponse.json();
    
    if (!cfData.success) {
      console.error('Cloudflare error:', cfData.errors);
      return res.status(500).json({ error: 'Failed to get upload URL' });
    }
    
    console.log(`✅ [API] Got Cloudflare upload URL for project ${id}`);
    
    // Return the upload URL and ID
    return res.status(200).json({
      uploadURL: cfData.result.uploadURL,
      imageId: cfData.result.id
    });
    
  } catch (error) {
    console.error('❌ [API] Get upload URL error:', error);
    return res.status(500).json({ error: 'Failed to get upload URL' });
  }
}