// lpai-backend/pages/api/quotes/[id]/generate-pdf.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { r2Client, R2_BUCKET_NAME } from '../../../../src/lib/r2';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
  maxDuration: 30,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  const { locationId } = req.body;

  try {
    console.log('[PDF Generator] Starting for quote:', id);
    
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get quote with all data
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(id as string),
      locationId
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Ensure web link token exists
    if (!quote.webLinkToken) {
      const crypto = require('crypto');
      const webLinkToken = crypto.randomBytes(32).toString('hex');
      
      await db.collection('quotes').updateOne(
        { _id: new ObjectId(id as string) },
        { 
          $set: { 
            webLinkToken,
            webLinkExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          }
        }
      );
      
      quote.webLinkToken = webLinkToken;
    }

    // Generate PDF from your web presentation with PDF mode enabled
    const webUrl = `https://www.fieldserv.ai/quote/${quote.webLinkToken}?pdf=true`;
    console.log('[PDF Generator] Using web URL with PDF mode:', webUrl);

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    try {
      const page = await browser.newPage();
      
      // Set viewport for tablet size
      await page.setViewport({ width: 1024, height: 1366 });
      
      // Navigate to quote presentation
      console.log('[PDF Generator] Loading quote presentation...');
      await page.goto(webUrl, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });
      
      // Wait for presentation to load
      await page.waitForSelector('[data-quote-loaded="true"]', { 
        timeout: 10000 
      }).catch(() => {
        console.log('[PDF Generator] Quote loaded indicator not found, waiting 3 seconds...');
      });
      
      // Extra wait for animations/images
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));
      
      // Generate PDF with template styling preserved
      console.log('[PDF Generator] Generating PDF...');
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '15mm',
          right: '10mm',
          bottom: '15mm',
          left: '10mm'
        },
        displayHeaderFooter: false,
        preferCSSPageSize: false,
        scale: 0.9,
      });
      
      console.log('[PDF Generator] PDF generated, size:', pdfBuffer.length);
      
      // Store in R2
      const timestamp = Date.now();
      const type = quote.signatures?.customer ? 'signed' : quote.status === 'published' ? 'published' : 'draft';
      const key = `pdfs/${locationId}/${type}/${quote.quoteNumber}_${timestamp}.pdf`;
      
      await r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        ContentDisposition: `inline; filename="${quote.quoteNumber}.pdf"`,
        Metadata: {
          quoteId: id as string,
          quoteNumber: quote.quoteNumber,
          customerName: quote.customerName || quote.contactName,
          locationId: locationId,
          hasSignatures: String(!!quote.signatures?.customer),
          generatedAt: new Date().toISOString(),
          webUrl: webUrl
        }
      }));
      
      console.log('[PDF Generator] Stored in R2:', key);
      
      // ✅ Generate signed URL for downloads (7-day expiry)
      const getCommand = new GetObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
      });
      const signedUrl = await getSignedUrl(r2Client, getCommand, { expiresIn: 3600 * 24 * 7 });
      
      console.log('[PDF Generator] Signed URL generated:', signedUrl);
      
      // Update quote with PDF info INCLUDING signed URL
      await db.collection('quotes').updateOne(
        { _id: new ObjectId(id as string) },
        {
          $set: {
            pdfUrl: signedUrl,        // ✅ Email uses this!
            r2PdfUrl: signedUrl,      // ✅ Backup field
            pdfR2Key: key,
            pdfGeneratedAt: new Date().toISOString(),
            pdfSize: pdfBuffer.length
          },
          $push: {
            activityFeed: {
              action: 'pdf_generated',
              timestamp: new Date().toISOString(),
              userId: 'system',
              metadata: {
                key: key,
                size: pdfBuffer.length,
                method: 'puppeteer_web'
              }
            }
          }
        }
      );
      
      return res.status(200).json({
        success: true,
        pdf: {
          key: key,
          size: pdfBuffer.length,
          url: signedUrl  // ✅ Return signed URL
        }
      });
      
    } finally {
      await browser.close();
    }
    
  } catch (error: any) {
    console.error('[PDF Generator] Error:', error);
    
    return res.status(200).json({
      success: true,
      pdfPending: true,
      message: 'PDF generation queued'
    });
  }
}