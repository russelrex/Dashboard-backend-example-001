// lpai-backend/pages/api/projects/[id]/photos/presign.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { generatePhotoKey, getUploadUrl, getViewUrl } from '../../../../../src/lib/r2';

// Enable body parser for this endpoint
export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const { locationId, filename, contentType, caption, stage, userId } = req.body;
  
  if (!id || !locationId || !filename || !contentType) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Verify project exists and belongs to location
    const project = await db.collection('projects').findOne({
      _id: new ObjectId(id as string),
      locationId
    });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Generate unique key for R2
    const key = generatePhotoKey(id as string, filename);
    
    // Get presigned upload URL
    const uploadUrl = await getUploadUrl(key, contentType);
    
    // Get view URL for immediate display
    const viewUrl = await getViewUrl(key);
    
    // Create photo record (don't save yet, save after successful upload)
    const photoRecord = {
      id: new ObjectId().toString(),
      key, // Legacy single key for now
      filename,
      contentType,
      caption: caption || '',
      stage: stage || 'site_visit',
      takenAt: new Date().toISOString(),
      takenBy: userId || 'unknown',
      size: 0, // Will be updated after upload
    };
    
    // Save pending photo record
    await db.collection('projects').updateOne(
      { _id: new ObjectId(id as string), locationId },
      { 
        $push: { 
          pendingPhotos: {
            ...photoRecord,
            uploadUrl,
            expiresAt: new Date(Date.now() + 3600000) // 1 hour
          }
        },
        $set: { updatedAt: new Date() }
      }
    );
    
    console.log(`✅ [API] Presigned URL generated for photo: ${filename}`);
    
    return res.status(200).json({
      photo: {
        id: photoRecord.id,
        url: viewUrl,
        thumbnail: viewUrl, // Same for now, will be updated after processing
        filename: photoRecord.filename,
        caption: photoRecord.caption,
        stage: photoRecord.stage,
        takenAt: photoRecord.takenAt,
        takenBy: photoRecord.takenBy,
      },
      uploadUrl,
      photoId: photoRecord.id, // For confirmation endpoint
    });
    
  } catch (error) {
    console.error('❌ [API] Presign error:', error);
    return res.status(500).json({ error: 'Failed to generate upload URL' });
  }
}