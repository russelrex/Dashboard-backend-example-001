/**
 * File: puppeteerPdfGenerator.ts
 * Purpose: Fast template-based PDF generation using Puppeteer
 * Author: LPai Team
 * Last Modified: 2025-01-03
 * Dependencies: puppeteer, template system
 */

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

class PuppeteerPdfGenerator {
  private browser: any = null;

  async initialize() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    }
  }

  async generateTemplatePDF(quoteId: string, locationId: string): Promise<Buffer> {
    console.log('[Puppeteer PDF] Starting generation for quote:', quoteId);
    const startTime = Date.now();

    try {
      await this.initialize();
      
      const page = await this.browser.newPage();
      
      // Set viewport for consistent rendering
      await page.setViewport({ width: 1200, height: 1600 });
      
      // Navigate to our PDF-optimized endpoint
      const pdfUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/quotes/${quoteId}/pdf-optimized?locationId=${locationId}`;
      
      console.log('[Puppeteer PDF] Loading URL:', pdfUrl);
      await page.goto(pdfUrl, { 
        waitUntil: 'networkidle2',
        timeout: 10000 
      });

      // Generate PDF with optimized settings
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '0.75in',
          right: '0.75in',
          bottom: '0.75in',
          left: '0.75in'
        },
        preferCSSPageSize: true
      });

      await page.close();

      const duration = Date.now() - startTime;
      console.log('[Puppeteer PDF] Generated successfully:', {
        duration: `${duration}ms`,
        size: `${pdfBuffer.length} bytes`,
        quoteId
      });

      return pdfBuffer;

    } catch (error: any) {
      console.error('[Puppeteer PDF] Error:', error);
      throw new Error(`PDF generation failed: ${error.message}`);
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export const puppeteerPdfGenerator = new PuppeteerPdfGenerator();
