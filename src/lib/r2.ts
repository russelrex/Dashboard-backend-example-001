// lpai-backend/src/lib/r2.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';

// Debug logging
console.log('[R2] Environment variables check:', {
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID ? 'SET' : 'NOT SET',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ? 'SET' : 'NOT SET',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET',
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ? 'SET' : 'NOT SET',
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL ? 'SET' : 'NOT SET',
});

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
export const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// Validate required environment variables
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('[R2] Missing required environment variables:', {
    R2_ACCOUNT_ID: !!R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: !!R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: !!R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: !!R2_BUCKET_NAME,
  });
  throw new Error('R2 configuration is incomplete. Please set all required environment variables.');
}

// Initialize R2 client (S3 compatible)
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// Generate unique filename
export function generatePhotoKey(projectId: string, filename: string) {
  const timestamp = Date.now();
  const ext = filename.split('.').pop() || 'jpg';
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `projects/${projectId}/${timestamp}_${sanitizedFilename}`;
}

// Generate image key for different variants
export function getImageKey(
  projectId: string,
  filename: string,
  variant: string = 'original'
): string {
  const timestamp = Date.now();
  const ext = filename.split('.').pop() || 'jpg';
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const sanitized = baseName.replace(/[^a-zA-Z0-9.-]/g, '_');
  
  return `projects/${projectId}/${variant}/${timestamp}_${sanitized}.jpg`;
}

// Get presigned upload URL (for PUT operations)
export async function getUploadUrl(key: string, contentType: string) {
  if (!R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  
  // URL expires in 5 minutes
  return await getSignedUrl(r2Client, command, { expiresIn: 300 });
}

// Get presigned view URL (for GET operations)
export async function getViewUrl(key: string): Promise<string> {
  if (!R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    
    // Generate signed URL for GET operation (viewing)
    // URL expires in 1 hour
    const url = await getSignedUrl(r2Client, command, {
      expiresIn: 3600, // 1 hour expiry for viewing
    });
    
    return url;
  } catch (error) {
    console.error('[R2] Failed to generate view URL:', error);
    throw error;
  }
}

// Get object metadata (NEW FUNCTION)
export async function getObjectMetadata(key: string) {
  if (!R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    
    const response = await r2Client.send(command);
    return response;
  } catch (error) {
    console.error('[R2] Failed to get object metadata:', error);
    return null;
  }
}

// Download object from R2 (NEW FUNCTION)
export async function downloadObject(key: string): Promise<Buffer> {
  if (!R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    
    const response = await r2Client.send(command);
    
    if (!response.Body) {
      throw new Error('No body in response');
    }
    
    // Convert stream to buffer
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  } catch (error) {
    console.error('[R2] Failed to download object:', error);
    throw error;
  }
}

// Upload multiple image variants
export async function uploadImageVariants(
  projectId: string,
  filename: string,
  variants: Record<string, Buffer>
): Promise<Record<string, { key: string; size: number }>> {
  if (!R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  const results: Record<string, { key: string; size: number }> = {};
  
  // Upload each variant
  const uploadPromises = Object.entries(variants).map(async ([variant, buffer]) => {
    const key = getImageKey(projectId, filename, variant);
    
    try {
      // Use multipart upload for larger files
      const upload = new Upload({
        client: r2Client,
        params: {
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: buffer,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000', // 1 year cache
        },
      });
      
      await upload.done();
      
      results[variant] = {
        key,
        size: buffer.length
      };
      
      console.log(`[R2] Uploaded ${variant}:`, key);
    } catch (error) {
      console.error(`[R2] Failed to upload ${variant}:`, error);
      throw error;
    }
  });
  
  await Promise.all(uploadPromises);
  return results;
}

// Get view URLs for all image variants
export async function getImageUrls(keys: Record<string, string>): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  
  for (const [variant, key] of Object.entries(keys)) {
    try {
      urls[variant] = await getViewUrl(key);
    } catch (error) {
      console.error(`[R2] Failed to get URL for ${variant}:`, error);
      // Continue with other variants even if one fails
    }
  }
  
  return urls;
}

// Delete photo from R2
export async function deletePhoto(key: string) {
  if (!R2_BUCKET_NAME) {
    throw new Error('R2_BUCKET_NAME is not configured');
  }

  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });
  
  await r2Client.send(command);
}

// Delete multiple photo variants
export async function deletePhotoVariants(keys: Record<string, string>) {
  const deletePromises = Object.values(keys).map(key => deletePhoto(key));
  
  try {
    await Promise.all(deletePromises);
    console.log('[R2] Deleted all photo variants');
  } catch (error) {
    console.error('[R2] Error deleting photo variants:', error);
    throw error;
  }
}

// Get public URL for a photo (deprecated - use getViewUrl instead)
export function getPhotoUrl(key: string) {
  // If R2_PUBLIC_URL is not set, construct it from the account ID
  const publicUrl = R2_PUBLIC_URL || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET_NAME}`;
  return `${publicUrl}/${key}`;
}