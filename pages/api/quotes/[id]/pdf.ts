/**
 * File: quotes/[id]/pdf.ts
 * Purpose: Generate PDF using Puppeteer from the PDF-optimized page
 * Author: LPai Team
 * Last Modified: 2025-09-03
 * Dependencies: puppeteer, R2 storage
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { r2Client, R2_BUCKET_NAME } from '../../../../src/lib/r2';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const PDF_BASE_URL = process.env.PDF_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'https://lpai-backend-omega.vercel.app';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id: quoteId } = req.query;
  const { locationId } = req.method === 'POST' ? req.body : req.query;

  console.log('[PDF API] Generate PDF request:', { 
    quoteId, 
    locationId, 
    method: req.method 
  });

  if (!quoteId || !locationId) {
    return res.status(400).json({
      success: false,
      error: 'Quote ID and location ID required'
    });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get quote data
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(quoteId as string),
      locationId: locationId as string
    });

    if (!quote) {
      return res.status(404).json({
        success: false,
        error: 'Quote not found'
      });
    }

    console.log('[PDF API] Quote found:', {
      quoteNumber: quote.quoteNumber,
      hasTemplate: !!quote.templateSnapshot,
      templateName: quote.templateSnapshot?.name
    });

    // Check if we already have a recent PDF
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    if (quote.pdfGeneratedAt && 
        new Date(quote.pdfGeneratedAt) > fiveMinutesAgo && 
        quote.pdfUrl &&
        req.method === 'GET') {
      console.log('[PDF API] Using cached PDF:', {
        generatedAt: quote.pdfGeneratedAt,
        url: quote.pdfUrl
      });
      
      return res.status(200).json({
        success: true,
        pdf: {
          fileId: quote.pdfR2Key || `pdf_${quoteId}`,
          filename: `Quote-${quote.quoteNumber}.pdf`,
          url: quote.pdfUrl,
          size: 0 // Unknown for cached
        }
      });
    }

    console.log('[PDF API] Generating new PDF using Puppeteer...');

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();
      
      // Set viewport for consistent PDF generation
      await page.setViewport({
        width: 1200,
        height: 1600,
        deviceScaleFactor: 2
      });

      // Use the public quote page that already works for customers
      const pdfPageUrl = quote.webLinkToken 
        ? `https://www.fieldserv.ai/quote/${quote.webLinkToken}`
        : `${PDF_BASE_URL}/api/quotes/${quoteId}/pdf-view?locationId=${locationId}`;
      console.log('[PDF API] Navigating to PDF page:', pdfPageUrl);

      await page.goto(pdfPageUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000
      });

      // Wait for the main content to load (use a more reliable selector)
      try {
        await page.waitForSelector('[data-testid="quote-container"], .quote-container, main', { timeout: 15000 });
      } catch (selectorError) {
        console.log('[PDF API] Primary selectors not found, waiting for any content...');
        await page.waitForTimeout(5000);
      }

      console.log('[PDF API] Page loaded, generating PDF...');

      // Generate PDF
      const pdfBuffer = await page.pdf({
        format: 'letter',
        printBackground: true,
        margin: {
          top: '0.5in',
          right: '0.5in',
          bottom: '0.5in',
          left: '0.5in'
        },
        preferCSSPageSize: true
      });

      console.log('[PDF API] PDF generated:', {
        size: pdfBuffer.length,
        quoteNumber: quote.quoteNumber
      });

      // Upload to R2 storage
      const timestamp = Date.now();
      const r2Key = `pdfs/${locationId}/${quote.status}/${quote.quoteNumber}_${timestamp}.pdf`;
      
      await r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: r2Key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        Metadata: {
          quoteId: quoteId as string,
          quoteNumber: quote.quoteNumber,
          locationId: locationId as string,
          generatedAt: now.toISOString()
        }
      }));

      // Generate signed URL for access
      const getCommand = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: r2Key,
      });
      const r2Url = await getSignedUrl(r2Client, getCommand, { expiresIn: 3600 * 24 * 7 }); // 7 days

      console.log('[PDF API] PDF uploaded to R2:', {
        key: r2Key,
        url: r2Url
      });

      // Update quote with PDF info
      await db.collection('quotes').updateOne(
        { _id: new ObjectId(quoteId as string) },
        {
          $set: {
            pdfUrl: r2Url,
            pdfR2Key: r2Key,
            pdfGeneratedAt: now,
            updatedAt: now
          },
          $push: {
            activityFeed: {
              action: 'pdf_generated',
              timestamp: now,
              metadata: {
                fileSize: pdfBuffer.length,
                r2Key: r2Key
              }
            }
          } as any
        }
      );

      console.log('[PDF API] Quote updated with PDF info');

      // Return success response
      return res.status(200).json({
        success: true,
        pdf: {
          fileId: r2Key,
          filename: `Quote-${quote.quoteNumber}.pdf`,
          url: r2Url,
          size: pdfBuffer.length
        }
      });

    } finally {
      await browser.close();
    }

  } catch (error) {
    console.error('[PDF API] Error generating PDF:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to generate PDF',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export const config = {
  api: {
    responseLimit: false, // Allow large PDF responses
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 30 // Allow up to 30s for PDF generation
};