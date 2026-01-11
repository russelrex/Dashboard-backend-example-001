/**
 * File: download-pdf.ts
 * Purpose: Generate and download PDF on-demand from public token (query param)
 * Author: LPai Team
 * Last Modified: 2025-10-10
 * Dependencies: puppeteer, R2 storage, MongoDB
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { r2Client, R2_BUCKET_NAME } from '../../../../src/lib/r2';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const config = {
  api: {
    responseLimit: false,
    bodyParser: { sizeLimit: '10mb' },
  },
  maxDuration: 30,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token } = req.query; // Get token from query parameter

  console.log('[Download PDF] Request for token:', token);

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid token' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Find quote by webLinkToken
    const quote = await db.collection('quotes').findOne({
      webLinkToken: token,
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    console.log('[Download PDF] Found quote:', {
      id: quote._id,
      quoteNumber: quote.quoteNumber,
      hasPdf: !!quote.pdfUrl,
      pdfGeneratedAt: quote.pdfGeneratedAt,
    });

    // Check if we have a recent PDF (within 5 minutes)
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    
    if (
      quote.pdfUrl &&
      quote.pdfGeneratedAt &&
      new Date(quote.pdfGeneratedAt) > fiveMinutesAgo
    ) {
      console.log('[Download PDF] Using cached PDF, redirecting to:', quote.pdfUrl);
      return res.redirect(302, quote.pdfUrl);
    }

    // Generate new PDF
    console.log('[Download PDF] Generating fresh PDF...');

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();

      // Set viewport
      await page.setViewport({
        width: 1200,
        height: 1600,
        deviceScaleFactor: 2,
      });

      // Navigate to the quote page with PDF mode
      const webUrl = `https://www.fieldserv.ai/quote/${token}?pdf=true`;
      console.log('[Download PDF] Loading page:', webUrl);

      await page.goto(webUrl, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      // Wait for content to load - FIXED
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Generate PDF
      console.log('[Download PDF] Generating PDF buffer...');
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '15mm',
          right: '10mm',
          bottom: '15mm',
          left: '10mm',
        },
        displayHeaderFooter: false,
        preferCSSPageSize: false,
        scale: 0.9,
      });

      console.log('[Download PDF] PDF generated, size:', pdfBuffer.length);

      // Upload to R2
      const timestamp = Date.now();
      const type = quote.status === 'signed' ? 'signed' : 'published';
      const key = `pdfs/${quote.locationId}/${type}/${quote.quoteNumber}_${timestamp}.pdf`;

      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          ContentDisposition: `attachment; filename="Quote-${quote.quoteNumber}.pdf"`,
          Metadata: {
            quoteId: quote._id.toString(),
            quoteNumber: quote.quoteNumber,
            locationId: quote.locationId,
            generatedAt: now.toISOString(),
          },
        })
      );

      console.log('[Download PDF] Uploaded to R2:', key);

      // Generate signed URL (7 days)
      const getCommand = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      });
      const signedUrl = await getSignedUrl(r2Client, getCommand, {
        expiresIn: 3600 * 24 * 7,
      });

      // Update quote with new PDF info
      await db.collection('quotes').updateOne(
        { _id: quote._id },
        {
          $set: {
            pdfUrl: signedUrl,
            pdfR2Key: key,
            pdfGeneratedAt: now,
            pdfSize: pdfBuffer.length,
          },
        }
      );

      console.log('[Download PDF] Quote updated, redirecting to signed URL');

      // Redirect to the signed URL for download
      return res.redirect(302, signedUrl);

    } finally {
      await browser.close();
    }

  } catch (error) {
    console.error('[Download PDF] Error:', error);
    return res.status(500).json({
      error: 'Failed to generate PDF',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}