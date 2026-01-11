// lpai-backend/pages/api/projects/[id]/photos.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

// Cloudflare delivery URL - TODO: Move to environment variable
const CF_DELIVERY_URL = process.env.CF_DELIVERY_URL || 'https://imagedelivery.net/4hDzQEaOi54scrgmdmfdaQ';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const { locationId } = req.method === 'GET' ? req.query : req.body;
  
  if (!id || !locationId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    switch (req.method) {
      case 'GET':
        // Get project photos
        const project = await db.collection('projects').findOne(
          { _id: new ObjectId(id as string), locationId },
          { projection: { photos: 1 } }
        );
        
        console.log(`📸 [API] Found ${project?.photos?.length || 0} photos for project ${id}`);
        
        if (!project?.photos || project.photos.length === 0) {
          return res.status(200).json([]);
        }
        
        // Transform photos to include Cloudflare URLs
        const photosWithUrls = project.photos.map((photo: any) => ({
          id: photo.id,
          url: photo.cloudflareId 
            ? `${CF_DELIVERY_URL}/${photo.cloudflareId}/mobile`
            : photo.url, // Fallback for old photos
          thumbnail: photo.cloudflareId
            ? `${CF_DELIVERY_URL}/${photo.cloudflareId}/thumbnail`
            : photo.thumbnail || photo.url,
          urls: photo.cloudflareId ? {
            original: `${CF_DELIVERY_URL}/${photo.cloudflareId}/public`,
            medium: `${CF_DELIVERY_URL}/${photo.cloudflareId}/mobile`,
            thumbnail: `${CF_DELIVERY_URL}/${photo.cloudflareId}/thumbnail`
          } : photo.urls,
          filename: photo.filename,
          contentType: photo.contentType || 'image/jpeg',
          caption: photo.caption || '',
          stage: photo.stage || 'general',
          takenAt: photo.takenAt,
          takenBy: photo.takenBy,
          size: photo.size || 0,
          cloudflareId: photo.cloudflareId,
        }));
        
        return res.status(200).json(photosWithUrls);
        
      case 'POST':
        // Simple save - no processing needed!
        const { cloudflareId, filename, caption, stage, userId } = req.body;
        
        if (!cloudflareId) {
          return res.status(400).json({ error: 'Missing cloudflareId' });
        }
        
        // Create photo record
        const photoRecord = {
          id: new ObjectId().toString(),
          cloudflareId,
          filename: filename || 'photo.jpg',
          contentType: 'image/jpeg',
          caption: caption || '',
          stage: stage || 'site_visit',
          takenAt: new Date().toISOString(),
          takenBy: userId || 'unknown',
          size: 0, // We don't know the size from Cloudflare
        };
        
        // Save to MongoDB
        const updateResult = await db.collection('projects').updateOne(
          { _id: new ObjectId(id as string), locationId },
          { 
            $push: { 
              photos: photoRecord,
              timeline: {
                id: new ObjectId().toString(),
                event: 'photo_added',
                description: `Photo added: ${photoRecord.caption || photoRecord.filename}`,
                timestamp: new Date().toISOString(),
                metadata: { 
                  photoId: photoRecord.id, 
                  filename: photoRecord.filename,
                  cloudflareId: photoRecord.cloudflareId
                }
              }
            },
            $set: { updatedAt: new Date() }
          }
        );
        
        if (updateResult.matchedCount === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        console.log(`✅ [API] Photo saved with Cloudflare ID: ${cloudflareId}`);
        
        // Return the saved photo (backend doesn't need to return URLs anymore)
        return res.status(201).json(photoRecord);
        
      case 'DELETE':
        const { photoId } = req.body;
        
        if (!photoId) {
          return res.status(400).json({ error: 'Missing photoId' });
        }
        
        // Note: In production, you might want to also delete from Cloudflare
        // using their API, but for now we'll just remove from database
        
        // Remove from MongoDB
        await db.collection('projects').updateOne(
          { _id: new ObjectId(id as string), locationId },
          { 
            $pull: { photos: { id: photoId } },
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'photo_deleted',
                description: 'Photo deleted',
                timestamp: new Date().toISOString(),
                metadata: { photoId }
              }
            },
            $set: { updatedAt: new Date() }
          }
        );
        
        return res.status(200).json({ success: true });
        
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('❌ [API] Photo error:', error);
    return res.status(500).json({ error: 'Failed to handle photo request' });
  }
}