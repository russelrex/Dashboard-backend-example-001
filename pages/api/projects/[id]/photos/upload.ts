// lpai-backend/pages/api/projects/[id]/photos/upload.ts
// This is the existing multipart upload logic, moved to its own endpoint
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import { uploadImageVariants, getImageUrls, getImageKey } from '../../../../../src/lib/r2';
import { processImage } from '../../../../../src/lib/imageProcessor';
import formidable from 'formidable';
import { promises as fs } from 'fs';

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  
  try {
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
    });
    
    const [fields, files] = await form.parse(req);
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Extract fields
    const extractField = (field: any) => Array.isArray(field) ? field[0] : field;
    const locationId = extractField(fields.locationId);
    
    if (!id || !locationId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
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
    
    // Read file
    const buffer = await fs.readFile(file.filepath);
    
    console.log(`📸 [API] Processing image: ${file.originalFilename}, size: ${file.size}`);
    
    // Process image into multiple sizes
    const variants = await processImage(buffer, ['thumbnail', 'medium']);
    
    // Upload all variants to R2
    const uploadResults = await uploadImageVariants(
      id as string,
      file.originalFilename || 'photo.jpg',
      variants
    );
    
    // Get view URLs for immediate display
    const urls = await getImageUrls(
      Object.fromEntries(
        Object.entries(uploadResults).map(([variant, result]) => [variant, result.key])
      )
    );
    
    // Create photo record with all variants
    const photoRecord = {
      id: new ObjectId().toString(),
      keys: Object.fromEntries(
        Object.entries(uploadResults).map(([variant, result]) => [variant, result.key])
      ),
      sizes: Object.fromEntries(
        Object.entries(uploadResults).map(([variant, result]) => [variant, result.size])
      ),
      filename: file.originalFilename || 'photo.jpg',
      contentType: 'image/jpeg',
      caption: extractField(fields.caption) || '',
      stage: extractField(fields.stage) || 'site_visit',
      takenAt: new Date().toISOString(),
      takenBy: extractField(fields.userId) || 'unknown',
      originalSize: file.size,
    };
    
    // Save to MongoDB
    await db.collection('projects').updateOne(
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
              variants: Object.keys(variants)
            }
          }
        },
        $set: { updatedAt: new Date() }
      }
    );
    
    console.log(`✅ [API] Photo uploaded with variants:`, Object.keys(variants));
    
    // Clean up temp file
    await fs.unlink(file.filepath).catch(() => {});
    
    return res.status(201).json({
      photo: {
        id: photoRecord.id,
        url: urls.medium || urls.original,
        thumbnail: urls.thumbnail || urls.original,
        urls,
        filename: photoRecord.filename,
        caption: photoRecord.caption,
        stage: photoRecord.stage,
        takenAt: photoRecord.takenAt,
        takenBy: photoRecord.takenBy,
        size: photoRecord.originalSize,
      }
    });
    
  } catch (error) {
    console.error('❌ [API] Upload error:', error);
    return res.status(500).json({ error: 'Failed to upload photo' });
  }
}