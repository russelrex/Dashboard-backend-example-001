// lpai-backend/pages/api/projects/[id]/photos/confirm.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { getObjectMetadata, downloadObject, getViewUrl } from '../../../../../src/lib/r2';
import { processImage, getImageKey } from '../../../../../src/lib/imageProcessor';
import { uploadImageVariants, getImageUrls } from '../../../../../src/lib/r2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const { locationId, photoId, processImage: shouldProcess = true } = req.body;
  
  if (!id || !locationId || !photoId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Find pending photo
    const project = await db.collection('projects').findOne({
      _id: new ObjectId(id as string),
      locationId,
      'pendingPhotos.id': photoId
    });
    
    if (!project) {
      return res.status(404).json({ error: 'Pending photo not found' });
    }
    
    const pendingPhoto = project.pendingPhotos.find((p: any) => p.id === photoId);
    if (!pendingPhoto) {
      return res.status(404).json({ error: 'Pending photo not found' });
    }
    
    // Verify upload succeeded by checking R2
    const metadata = await getObjectMetadata(pendingPhoto.key);
    if (!metadata) {
      return res.status(400).json({ error: 'Upload not found in storage' });
    }
    
    let finalPhotoRecord: any = {
      id: pendingPhoto.id,
      key: pendingPhoto.key,
      filename: pendingPhoto.filename,
      contentType: pendingPhoto.contentType,
      caption: pendingPhoto.caption,
      stage: pendingPhoto.stage,
      takenAt: pendingPhoto.takenAt,
      takenBy: pendingPhoto.takenBy,
      size: metadata.ContentLength || 0,
      originalSize: metadata.ContentLength || 0,
    };
    
    // Process image to create variants
    if (shouldProcess && pendingPhoto.contentType?.startsWith('image/')) {
      try {
        console.log(`📸 [API] Processing image variants for: ${pendingPhoto.filename}`);
        
        // Download original
        const originalBuffer = await downloadObject(pendingPhoto.key);
        
        // Generate variants
        const variants = await processImage(originalBuffer, ['thumbnail', 'medium']);
        
        // Upload variants
        const uploadResults = await uploadImageVariants(
          id as string,
          pendingPhoto.filename,
          variants
        );
        
        // Update photo record with variant keys
        finalPhotoRecord.keys = Object.fromEntries(
          Object.entries(uploadResults).map(([variant, result]) => [variant, result.key])
        );
        finalPhotoRecord.sizes = Object.fromEntries(
          Object.entries(uploadResults).map(([variant, result]) => [variant, result.size])
        );
        
        console.log(`✅ [API] Created variants:`, Object.keys(variants));
      } catch (processError) {
        console.error('⚠️ [API] Image processing failed, using original only:', processError);
        // Continue without variants
      }
    }
    
    // Move from pending to confirmed photos
    await db.collection('projects').updateOne(
      { _id: new ObjectId(id as string), locationId },
      {
        $pull: { pendingPhotos: { id: photoId } },
        $push: { 
          photos: finalPhotoRecord,
          timeline: {
            id: new ObjectId().toString(),
            event: 'photo_added',
            description: `Photo added: ${finalPhotoRecord.caption || finalPhotoRecord.filename}`,
            timestamp: new Date().toISOString(),
            metadata: { 
              photoId: finalPhotoRecord.id, 
              filename: finalPhotoRecord.filename,
              size: finalPhotoRecord.size,
              hasVariants: !!finalPhotoRecord.keys
            }
          }
        },
        $set: { updatedAt: new Date() }
      }
    );
    
    // Get view URLs for response
    let urls: Record<string, string> = {};
    if (finalPhotoRecord.keys) {
      urls = await getImageUrls(finalPhotoRecord.keys);
    } else {
      const viewUrl = await getViewUrl(finalPhotoRecord.key);
      urls = { original: viewUrl, thumbnail: viewUrl, medium: viewUrl };
    }
    
    console.log(`✅ [API] Photo confirmed and processed: ${photoId}`);
    
    return res.status(200).json({
      success: true,
      photo: {
        id: finalPhotoRecord.id,
        url: urls.medium || urls.original,
        thumbnail: urls.thumbnail || urls.original,
        urls,
        filename: finalPhotoRecord.filename,
        caption: finalPhotoRecord.caption,
        stage: finalPhotoRecord.stage,
        takenAt: finalPhotoRecord.takenAt,
        takenBy: finalPhotoRecord.takenBy,
        size: finalPhotoRecord.originalSize,
      }
    });
    
  } catch (error) {
    console.error('❌ [API] Confirm error:', error);
    return res.status(500).json({ error: 'Failed to confirm upload' });
  }
}