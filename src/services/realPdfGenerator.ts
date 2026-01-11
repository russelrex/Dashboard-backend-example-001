// src/services/realPdfGenerator.ts
// Complete PDF Generator using PDFKit for Vercel deployment

import PDFDocument from 'pdfkit';

interface QuoteData {
  quoteNumber: string;
  title?: string;
  description?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  status?: string;
  createdAt?: Date;
  validUntil?: Date;
  lineItems?: Array<{
    name: string;
    description?: string;
    quantity: number;
    price: number;
    total: number;
  }>;
  tax?: number;
  total: number;
  termsAndConditions?: string;
}

interface CompanyData {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  tagline?: string;
  logoUrl?: string;
  termsAndConditions?: string;
}

interface Signatures {
  customer?: string;
  consultant?: string;
  customerSignedAt?: Date;
  consultantSignedAt?: Date;
  consultantName?: string;
}

class RealPDFGenerator {
  private formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  }

  private formatDate(date: string | Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  async generateSignedQuotePDF(
    quote: QuoteData,
    template: any, // Not used with PDFKit
    companyData: CompanyData,
    signatures: Signatures
  ): Promise<Buffer> {
    console.log('[Real PDF Generator] Generating PDF for quote:', quote.quoteNumber);

    return new Promise((resolve, reject) => {
      try {
        // Create PDF document
        const doc = new PDFDocument({
          margin: 50,
          size: 'A4'
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => {
          const result = Buffer.concat(chunks);
          console.log('[Real PDF Generator] PDF generated successfully:', {
            size: result.length,
            pages: 2,
            quoteNumber: quote.quoteNumber
          });
          resolve(result);
        });
        doc.on('error', reject);

        // Page 1: Quote Details
        this.createQuotePage(doc, quote, companyData);
        
        // Page 2: Terms and Signatures
        doc.addPage();
        this.createTermsAndSignaturesPage(doc, quote, companyData, signatures);

        // Finalize the PDF
        doc.end();

      } catch (error) {
        console.error('[Real PDF Generator] Error generating PDF:', error);
        reject(new Error(`Failed to generate PDF: ${error.message}`));
      }
    });
  }

  async generateQuotePDF(quote: QuoteData, template: any, companyData: CompanyData): Promise<Buffer> {
    return this.generateSignedQuotePDF(quote, template, companyData, {});
  }

  private createQuotePage(doc: PDFKit.PDFDocument, quote: QuoteData, companyData: CompanyData) {
    const pageWidth = doc.page.width - 100; // Account for margins

    // Header with company info
    doc.fillColor('#2E86AB')
       .fontSize(24)
       .text(companyData.name || 'Your Company', 50, 50);

    doc.fillColor('#666666')
       .fontSize(10)
       .text([
         companyData.phone || '',
         companyData.email || '',
         companyData.address || ''
       ].filter(Boolean).join(' | '), 50, 80);

    // Horizontal line
    doc.strokeColor('#2E86AB')
       .lineWidth(2)
       .moveTo(50, 110)
       .lineTo(pageWidth + 50, 110)
       .stroke();

    // Quote header section
    let yPos = 130;
    
    // Left side - Quote info
    doc.fillColor('#333333')
       .fontSize(18)
       .text(quote.title || 'Quote', 50, yPos);

    if (quote.description) {
      doc.fontSize(12)
         .text(quote.description, 50, yPos + 25, { width: pageWidth - 200 });
      yPos += 50;
    } else {
      yPos += 30;
    }

    // Right side - Quote details box
    const boxX = pageWidth - 150;
    doc.rect(boxX, 130, 150, 100)
       .fillAndStroke('#f8f9fa', '#e9ecef');

    doc.fillColor('#333333')
       .fontSize(10)
       .text(`Quote #: ${quote.quoteNumber}`, boxX + 10, 140)
       .text(`Date: ${this.formatDate(quote.createdAt || new Date())}`, boxX + 10, 155)
       .text(`Valid Until: ${quote.validUntil ? this.formatDate(quote.validUntil) : 'Please Inquire'}`, boxX + 10, 170)
       .text(`Status: ${quote.status || 'Draft'}`, boxX + 10, 185);

    // Customer info section
    yPos += 30;
    doc.fillColor('#666666')
       .fontSize(10)
       .text('QUOTE FOR:', 50, yPos);

    doc.fillColor('#333333')
       .fontSize(12)
       .text(quote.customerName, 50, yPos + 15);

    if (quote.customerEmail || quote.customerPhone || quote.customerAddress) {
      doc.fontSize(10)
         .fillColor('#666666');
      
      let contactY = yPos + 30;
      if (quote.customerEmail) {
        doc.text(quote.customerEmail, 50, contactY);
        contactY += 15;
      }
      if (quote.customerPhone) {
        doc.text(quote.customerPhone, 50, contactY);
        contactY += 15;
      }
      if (quote.customerAddress) {
        doc.text(quote.customerAddress, 50, contactY, { width: 300 });
      }
    }

    // Line items table
    yPos += 100;
    this.createLineItemsTable(doc, quote.lineItems || [], yPos);

    // Totals section
    const totalsX = pageWidth - 150;
    let totalsY = doc.y + 30;

    // Subtotal
    const subtotal = (quote.lineItems || []).reduce((sum, item) => sum + (item.total || 0), 0);
    doc.fontSize(10)
       .fillColor('#666666')
       .text('Subtotal:', totalsX, totalsY)
       .fillColor('#333333')
       .text(this.formatCurrency(subtotal), totalsX + 80, totalsY, { align: 'right', width: 70 });

    // Tax
    if (quote.tax && quote.tax > 0) {
      totalsY += 15;
      doc.fillColor('#666666')
         .text('Tax:', totalsX, totalsY)
         .fillColor('#333333')
         .text(this.formatCurrency(quote.tax), totalsX + 80, totalsY, { align: 'right', width: 70 });
    }

    // Total
    totalsY += 20;
    doc.strokeColor('#cccccc')
       .lineWidth(1)
       .moveTo(totalsX, totalsY - 5)
       .lineTo(totalsX + 150, totalsY - 5)
       .stroke();

    doc.fontSize(12)
       .fillColor('#2E86AB')
       .text('Total:', totalsX, totalsY)
       .text(this.formatCurrency(quote.total), totalsX + 80, totalsY, { align: 'right', width: 70 });

    // Page footer
    doc.fillColor('#999999')
       .fontSize(8)
       .text(`${companyData.name || 'Your Company'} | ${companyData.phone || ''} | ${companyData.email || ''}`, 
             50, doc.page.height - 50, { align: 'center', width: pageWidth });

    doc.text('Page 1', doc.page.width - 100, doc.page.height - 30);
  }

  private createLineItemsTable(doc: PDFKit.PDFDocument, lineItems: any[], startY: number) {
    const pageWidth = doc.page.width - 100;
    const colWidths = {
      item: pageWidth * 0.45,
      qty: pageWidth * 0.15,
      price: pageWidth * 0.20,
      total: pageWidth * 0.20
    };

    // Table header
    doc.rect(50, startY, pageWidth, 30)
       .fillAndStroke('#f8f9fa', '#e9ecef');

    doc.fillColor('#333333')
       .fontSize(10)
       .font('Helvetica-Bold')
       .text('Item', 60, startY + 10)
       .text('Qty', 60 + colWidths.item, startY + 10)
       .text('Price', 60 + colWidths.item + colWidths.qty, startY + 10)
       .text('Total', 60 + colWidths.item + colWidths.qty + colWidths.price, startY + 10);

    // Table rows
    doc.font('Helvetica');
    let yPos = startY + 30;

    lineItems.forEach((item, index) => {
      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(50, yPos, pageWidth, 40)
           .fill('#fafbfc');
      }

      // Item name and description
      doc.fillColor('#333333')
         .fontSize(10)
         .text(item.name || 'Item', 60, yPos + 5);

      if (item.description && item.description !== item.name) {
        doc.fillColor('#666666')
           .fontSize(8)
           .text(item.description, 60, yPos + 18, { width: colWidths.item - 20 });
      }

      // Quantity
      doc.fillColor('#333333')
         .fontSize(10)
         .text(item.quantity?.toString() || '1', 60 + colWidths.item, yPos + 5);

      // Price
      doc.text(this.formatCurrency(item.price || 0), 60 + colWidths.item + colWidths.qty, yPos + 5);

      // Total
      doc.text(this.formatCurrency(item.total || 0), 60 + colWidths.item + colWidths.qty + colWidths.price, yPos + 5);

      yPos += 40;
    });

    // Table bottom border
    doc.strokeColor('#e9ecef')
       .lineWidth(1)
       .moveTo(50, yPos)
       .lineTo(pageWidth + 50, yPos)
       .stroke();

    // Update document y position
    doc.y = yPos;
  }

  private createTermsAndSignaturesPage(doc: PDFKit.PDFDocument, quote: QuoteData, companyData: CompanyData, signatures: Signatures) {
    const pageWidth = doc.page.width - 100;

    // Page header
    doc.fillColor('#2E86AB')
       .fontSize(18)
       .text('Terms & Authorization', 50, 50);

    // Terms and conditions
    let yPos = 100;
    if (quote.termsAndConditions || companyData.termsAndConditions) {
      doc.fillColor('#333333')
         .fontSize(12)
         .text('Terms and Conditions', 50, yPos);

      doc.fillColor('#666666')
         .fontSize(9)
         .text(quote.termsAndConditions || companyData.termsAndConditions || 'Standard terms and conditions apply.', 
               50, yPos + 20, { width: pageWidth, align: 'justify' });

      yPos = doc.y + 40;
    }

    // Authorization section
    doc.fillColor('#333333')
       .fontSize(12)
       .text('Authorization', 50, yPos);

    doc.fillColor('#666666')
       .fontSize(9)
       .text('By signing below, both parties agree to the terms and conditions outlined in this quote.', 
             50, yPos + 20, { width: pageWidth });

    yPos += 60;

    // Signature boxes
    const boxWidth = (pageWidth - 30) / 2;

    // Customer signature box
    doc.rect(50, yPos, boxWidth, 100)
       .fillAndStroke('#ffffff', '#cccccc');

    doc.fillColor('#2E86AB')
       .fontSize(11)
       .text('Customer Signature', 60, yPos + 10);

    // If there's a customer signature, note it
    if (signatures.customer) {
      doc.fillColor('#666666')
         .fontSize(9)
         .text(`Digitally signed on ${this.formatDate(signatures.customerSignedAt || new Date())}`, 
               60, yPos + 25);
    }

    doc.fillColor('#333333')
       .fontSize(9)
       .text(`Name: ${quote.customerName || '____________________'}`, 60, yPos + 70)
       .text(`Date: ${signatures.customer ? this.formatDate(signatures.customerSignedAt || new Date()) : '____________________'}`, 
             60, yPos + 85);

    // Consultant signature box
    const consultantBoxX = 50 + boxWidth + 30;
    doc.rect(consultantBoxX, yPos, boxWidth, 100)
       .fillAndStroke('#ffffff', '#cccccc');

    doc.fillColor('#2E86AB')
       .fontSize(11)
       .text('Authorized Representative', consultantBoxX + 10, yPos + 10);

    // If there's a consultant signature, note it
    if (signatures.consultant) {
      doc.fillColor('#666666')
         .fontSize(9)
         .text(`Digitally signed on ${this.formatDate(signatures.consultantSignedAt || new Date())}`, 
               consultantBoxX + 10, yPos + 25);
    }

    doc.fillColor('#333333')
       .fontSize(9)
       .text(`Name: ${signatures.consultantName || companyData.name || '____________________'}`, 
             consultantBoxX + 10, yPos + 70)
       .text(`Date: ${signatures.consultant ? this.formatDate(signatures.consultantSignedAt || new Date()) : '____________________'}`, 
             consultantBoxX + 10, yPos + 85);

    // Page footer
    doc.fillColor('#999999')
       .fontSize(8)
       .text(`${companyData.name || 'Your Company'} | ${companyData.phone || ''} | ${companyData.email || ''}`, 
             50, doc.page.height - 50, { align: 'center', width: pageWidth });

    doc.text('Page 2', doc.page.width - 100, doc.page.height - 30);
  }

  // Test PDF generation
  async generateTestPDF(): Promise<Buffer> {
    const sampleQuote = {
      quoteNumber: 'Q-2025-TEST',
      title: 'Test Kitchen Renovation',
      description: 'Complete kitchen renovation including cabinets, countertops, and appliances.',
      customerName: 'John Smith',
      customerEmail: 'john@example.com',
      customerPhone: '+1-555-123-4567',
      customerAddress: '123 Main St, Anytown, ST 12345',
      status: 'draft',
      createdAt: new Date(),
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      lineItems: [
        {
          name: 'Custom Kitchen Cabinets',
          description: 'Solid wood cabinets with soft-close hardware',
          quantity: 1,
          price: 8500,
          total: 8500
        },
        {
          name: 'Quartz Countertops',
          description: 'Premium quartz with undermount sink cutout',
          quantity: 35,
          price: 85,
          total: 2975
        },
        {
          name: 'Appliance Package',
          description: 'Stainless steel refrigerator, dishwasher, and range',
          quantity: 1,
          price: 3200,
          total: 3200
        }
      ],
      tax: 1175,
      total: 15850
    };

    const sampleCompany = {
      name: 'Sample Renovation Co.',
      phone: '+1-555-987-6543',
      email: 'info@samplereno.com',
      address: '456 Business Ave, Commerce City, ST 54321',
      termsAndConditions: 'Standard terms and conditions apply.'
    };

    return this.generateQuotePDF(sampleQuote, null, sampleCompany);
  }
}

export const realPDFGenerator = new RealPDFGenerator();