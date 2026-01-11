// lpai-backend/src/lib/imageProcessor.ts
import sharp from 'sharp';
import { Readable } from 'stream';

export interface ImageSize {
  width: number;
  height: number;
  quality: number;
  suffix: string;
}

export const IMAGE_SIZES: Record<string, ImageSize> = {
  thumbnail: {
    width: 200,
    height: 200,
    quality: 80,
    suffix: 'thumb'
  },
  medium: {
    width: 800,
    height: 800,
    quality: 85,
    suffix: 'medium'
  },
  large: {
    width: 1920,
    height: 1920,
    quality: 90,
    suffix: 'large'
  }
};

export async function processImage(
  buffer: Buffer,
  sizes: string[] = ['thumbnail', 'medium']
): Promise<Record<string, Buffer>> {
  const results: Record<string, Buffer> = {};
  
  // Always include original
  results.original = buffer;
  
  // Get image metadata
  const metadata = await sharp(buffer).metadata();
  console.log('[ImageProcessor] Processing image:', {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    size: buffer.length
  });
  
  // Process each size
  for (const sizeName of sizes) {
    const size = IMAGE_SIZES[sizeName];
    if (!size) continue;
    
    try {
      // Only resize if image is larger than target
      const needsResize = 
        (metadata.width || 0) > size.width || 
        (metadata.height || 0) > size.height;
      
      let pipeline = sharp(buffer);
      
      if (needsResize) {
        pipeline = pipeline.resize(size.width, size.height, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }
      
      // Convert to JPEG for consistency and compression
      const processed = await pipeline
        .jpeg({ quality: size.quality })
        .toBuffer();
      
      results[sizeName] = processed;
      
      console.log(`[ImageProcessor] Generated ${sizeName}:`, {
        size: processed.length,
        reduction: Math.round((1 - processed.length / buffer.length) * 100) + '%'
      });
    } catch (error) {
      console.error(`[ImageProcessor] Error generating ${sizeName}:`, error);
      // Fall back to original if processing fails
      results[sizeName] = buffer;
    }
  }
  
  return results;
}

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