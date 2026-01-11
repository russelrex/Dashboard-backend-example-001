// src/services/r2Storage.ts
// Cloudflare R2 Storage Service for PDFs and Documents

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
  customDomain?: string;
}

interface UploadResult {
  fileId: string;
  filename: string;
  url: string;
  size: number;
  path: string;
}

class R2StorageService {
  private client: S3Client;
  private config: R2Config;

   constructor() {
    this.config = {
      accountId: process.env.R2_ACCOUNT_ID!,
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      bucketName: process.env.CLOUDFLARE_lpai_pdfs!,
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      // Use default R2 public domain (bucket needs to be public)
    };

    this.client = new S3Client({
      region: 'auto',
      endpoint: this.config.endpoint,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });
  }

  /**
   * Store PDF in R2 with organized folder structure
   */
  async storePDF(
    pdfBuffer: Buffer,
    quoteId: string,
    metadata: {
      quoteNumber: string;
      customerName: string;
      locationId: string;
      hasSignatures: boolean;
      generatedAt: string;
    }
  ): Promise<UploadResult> {
    const fileId = `pdf_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const filename = `quote_${metadata.quoteNumber}_${metadata.hasSignatures ? 'signed' : 'draft'}_${Date.now()}.pdf`;
    
    // Organize by location and year for better file management
    const year = new Date().getFullYear();
    const path = `pdfs/${metadata.locationId}/${year}/${filename}`;

    console.log('[R2 Storage] Uploading PDF:', { path, size: pdfBuffer.length });

    try {
      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: path,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        ContentDisposition: `inline; filename="${filename}"`,
        Metadata: {
          fileId,
          quoteId,
          quoteNumber: metadata.quoteNumber,
          customerName: metadata.customerName,
          locationId: metadata.locationId,
          hasSignatures: metadata.hasSignatures.toString(),
          generatedAt: metadata.generatedAt,
          uploadedAt: new Date().toISOString()
        }
      });

      await this.client.send(command);

      // Build public URL using custom domain
      const url = `${this.config.customDomain}/${path}`;

      console.log('[R2 Storage] PDF uploaded successfully:', url);

      return {
        fileId,
        filename,
        url,
        size: pdfBuffer.length,
        path
      };

    } catch (error) {
      console.error('[R2 Storage] Failed to upload PDF:', error);
      throw new Error(`Failed to store PDF in R2: ${error.message}`);
    }
  }

  /**
   * Retrieve PDF from R2 (for direct access, usually not needed due to public URLs)
   */
  async retrievePDF(path: string): Promise<{ buffer: Buffer; filename: string }> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: path,
      });

      const response = await this.client.send(command);
      
      if (!response.Body) {
        throw new Error('No data returned from R2');
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      const filename = path.split('/').pop() || 'document.pdf';

      return { buffer, filename };

    } catch (error) {
      console.error('[R2 Storage] Failed to retrieve PDF:', error);
      throw new Error(`Failed to retrieve PDF from R2: ${error.message}`);
    }
  }

  /**
   * Delete PDF from R2
   */
  async deletePDF(path: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucketName,
        Key: path,
      });

      await this.client.send(command);
      console.log('[R2 Storage] PDF deleted successfully:', path);

    } catch (error) {
      console.error('[R2 Storage] Failed to delete PDF:', error);
      throw new Error(`Failed to delete PDF from R2: ${error.message}`);
    }
  }

  /**
   * Store any file type (for future use - images, documents, etc.)
   */
  async storeFile(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    folder: string = 'files',
    metadata?: Record<string, string>
  ): Promise<UploadResult> {
    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const path = `${folder}/${filename}`;

    try {
      const command = new PutObjectCommand({
        Bucket: this.config.bucketName,
        Key: path,
        Body: fileBuffer,
        ContentType: contentType,
        Metadata: {
          fileId,
          uploadedAt: new Date().toISOString(),
          ...metadata
        }
      });

      await this.client.send(command);

      const url = `${this.config.customDomain}/${path}`;

      return {
        fileId,
        filename,
        url,
        size: fileBuffer.length,
        path
      };

    } catch (error) {
      console.error('[R2 Storage] Failed to upload file:', error);
      throw new Error(`Failed to store file in R2: ${error.message}`);
    }
  }

  /**
   * Get direct URL for a file (useful for email attachments)
   */
  getPublicUrl(path: string): string {
    return `${this.config.customDomain}/${path}`;
  }

  /**
   * Check if R2 is properly configured
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to list objects (will fail if credentials are wrong)
      const command = new GetObjectCommand({
        Bucket: this.config.bucketName,
        Key: 'health-check-non-existent-file'
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      // If error is 'NoSuchKey', R2 is working (file just doesn't exist)
      // If error is auth-related, R2 config is broken
      return error.name === 'NoSuchKey';
    }
  }
}

export const r2Storage = new R2StorageService();