/**
 * File: pdf-optimized.ts
 * Purpose: PDF-optimized HTML version of quote for Puppeteer conversion
 * Author: LPai Team
 * Last Modified: 2025-01-03
 * Dependencies: quote data, template system, HTML generation
 */

import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    const { locationId } = req.query;

    if (!id || !locationId) {
      return res.status(400).json({ error: 'Quote ID and locationId required' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get quote with all related data
    const quote = await db.collection('projects').findOne({
      _id: new ObjectId(id as string),
      locationId: locationId as string
    });

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Get location/company data
    const location = await db.collection('locations').findOne({
      _id: locationId as string
    });

    // Get template
    let template = null;
    if (quote.templateId) {
      try {
        template = await db.collection('templates').findOne({
          _id: new ObjectId(quote.templateId),
          $or: [
            { isGlobal: true },
            { locationId: locationId as string }
          ]
        });
      } catch (templateError) {
        console.warn('[PDF Optimized] Template lookup failed:', templateError);
        // Continue without template
      }
    }

    // Get contact data
    let contact = null;
    if (quote.contactId) {
      try {
        contact = await db.collection('contacts').findOne({
          _id: new ObjectId(quote.contactId),
          locationId: locationId as string
        });
      } catch (contactError) {
        console.warn('[PDF Optimized] Contact lookup failed:', contactError);
        // Continue without contact
      }
    }

    // Build variables (same logic as your web page)
    const currentYear = new Date().getFullYear();
    const establishedYear = parseInt(
      template?.companyOverrides?.establishedYear || 
      location?.establishedYear || 
      currentYear.toString()
    );
    const experienceYears = currentYear - establishedYear;

    const variables = {
      companyName: template?.companyOverrides?.name || location?.name || 'Your Company',
      companyLogo: template?.companyOverrides?.logo || location?.logoUrl || '🏢',
      companyTagline: template?.companyOverrides?.tagline || location?.tagline || 'Professional service',
      phone: template?.companyOverrides?.phone || location?.phone || '',
      email: template?.companyOverrides?.email || location?.email || '',
      address: template?.companyOverrides?.address || location?.address || '',
      establishedYear: template?.companyOverrides?.establishedYear || location?.establishedYear || currentYear.toString(),
      warrantyYears: template?.companyOverrides?.warrantyYears || location?.warrantyYears || '1',
      experienceYears: experienceYears.toString(),
      quoteNumber: quote.quoteNumber || 'Q-XXXX-XXX',
      customerName: contact ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim() : 'Customer',
      projectTitle: quote.title || 'Project',
      totalAmount: `$${(quote.total || 0).toLocaleString()}`,
      termsAndConditions: quote.termsAndConditions || '',
      paymentTerms: quote.paymentTerms || '',
      notes: quote.notes || '',
    };

    // Generate PDF-optimized HTML
    const pdfHtml = generatePdfHtml(quote, template, location, contact, variables);

    // Return HTML with PDF-specific CSS
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(pdfHtml);

  } catch (error) {
    console.error('[PDF Optimized API] Error:', error);
    return res.status(500).json({ error: 'Failed to generate PDF HTML' });
  }
}

function generatePdfHtml(quote: any, template: any, company: any, customer: any, variables: any): string {
  const enabledTabs = template?.tabs?.filter((tab: any) => tab.enabled)
    .sort((a: any, b: any) => a.order - b.order) || [];

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Quote ${quote.quoteNumber} - PDF</title>
    <style>
        /* PDF-optimized CSS */
        @page {
            size: A4;
            margin: 0.75in;
        }
        
        body {
            font-family: Arial, sans-serif;
            line-height: 1.4;
            color: #333;
            margin: 0;
            padding: 0;
        }
        
        .page-break {
            page-break-before: always;
        }
        
        .header {
            background: ${template?.styling?.primaryColor || '#2E86AB'};
            color: white;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 8px;
        }
        
        .hero {
            text-align: center;
            margin: 40px 0;
        }
        
        .hero h1 {
            font-size: 24px;
            color: ${template?.styling?.primaryColor || '#2E86AB'};
            margin: 0 0 10px 0;
        }
        
        .hero .subtitle {
            color: #666;
            font-size: 16px;
        }
        
        .cards {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            margin: 30px 0;
        }
        
        .card {
            flex: 1;
            min-width: 200px;
            padding: 20px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            text-align: center;
        }
        
        .card .icon {
            font-size: 32px;
            margin-bottom: 10px;
        }
        
        .quote-breakdown {
            margin: 30px 0;
        }
        
        .quote-breakdown table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        
        .quote-breakdown th,
        .quote-breakdown td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        
        .quote-breakdown th {
            background: #f8f9fa;
            font-weight: bold;
        }
        
        .total-row {
            font-weight: bold;
            font-size: 18px;
            background: #f0f8ff;
        }
        
        .process-steps {
            margin: 30px 0;
        }
        
        .step {
            display: flex;
            align-items: center;
            margin: 15px 0;
        }
        
        .step-number {
            background: ${template?.styling?.accentColor || '#A23B72'};
            color: white;
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 15px;
            font-weight: bold;
        }
        
        .terms-section {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 30px 0;
        }
        
        .signature-section {
            margin: 50px 0;
            padding: 20px;
            border: 2px dashed #ccc;
            text-align: center;
        }
        
        .footer {
            text-align: center;
            font-size: 12px;
            color: #666;
            margin-top: 40px;
            border-top: 1px solid #eee;
            padding-top: 20px;
        }
    </style>
</head>
<body>
    ${generateTabsHtml(enabledTabs, quote, variables, template)}
    
    <div class="footer">
        Generated on ${new Date().toLocaleDateString()} | Quote ${quote.quoteNumber}
    </div>
</body>
</html>`;
}

function generateTabsHtml(tabs: any[], quote: any, variables: any, template: any): string {
  return tabs.map((tab, index) => `
    ${index > 0 ? '<div class="page-break"></div>' : ''}
    <div class="tab-content">
        ${generateBlocksHtml(tab.blocks, quote, variables, template)}
    </div>
  `).join('');
}

function generateBlocksHtml(blocks: any[], quote: any, variables: any, template: any): string {
  return blocks
    .sort((a, b) => a.position - b.position)
    .map(block => generateBlockHtml(block, quote, variables, template))
    .join('');
}

function generateBlockHtml(block: any, quote: any, variables: any, template: any): string {
  const replaceVars = (text: string) => {
    let result = text;
    Object.entries(variables).forEach(([key, value]) => {
      result = result.replace(new RegExp(`{${key}}`, 'g'), String(value || ''));
    });
    return result;
  };

  switch (block.type) {
    case 'hero':
      return `
        <div class="hero">
            <div class="icon">${block.content.icon}</div>
            <h1>${replaceVars(block.content.title)}</h1>
            <div class="subtitle">${replaceVars(block.content.subtitle)}</div>
        </div>
      `;

    case 'benefit_cards':
      return `
        <div class="cards">
            ${block.content.cards.map((card: any) => `
                <div class="card">
                    <div class="icon">${card.icon}</div>
                    <h3>${replaceVars(card.title)}</h3>
                    <div class="subtitle">${replaceVars(card.subtitle)}</div>
                    <p>${replaceVars(card.description)}</p>
                </div>
            `).join('')}
        </div>
      `;

    case 'quote_breakdown':
      return `
        <div class="quote-breakdown">
            <h2>Quote Details</h2>
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Price</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${quote.sections?.map((section: any) => 
                        section.lineItems?.map((item: any) => `
                            <tr>
                                <td>${item.name}</td>
                                <td>${item.description}</td>
                                <td>${item.quantity}</td>
                                <td>$${item.unitPrice.toLocaleString()}</td>
                                <td>$${item.totalPrice.toLocaleString()}</td>
                            </tr>
                        `).join('')
                    ).join('') || ''}
                    <tr class="total-row">
                        <td colspan="4">Total</td>
                        <td>$${quote.total.toLocaleString()}</td>
                    </tr>
                </tbody>
            </table>
        </div>
      `;

    case 'process_steps':
      return `
        <div class="process-steps">
            <h2>Our Process</h2>
            ${block.content.steps.map((step: any) => `
                <div class="step">
                    <div class="step-number">${step.stepNumber}</div>
                    <div>
                        <h4>${step.title}</h4>
                        <p>${step.description}</p>
                        ${step.time ? `<small>Timeline: ${step.time}</small>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
      `;

    case 'terms_section':
      return `
        <div class="terms-section">
            <h3>${block.content.title}</h3>
            <p>${replaceVars(block.content.content)}</p>
        </div>
      `;

    default:
      return `<div><!-- Unsupported block type: ${block.type} --></div>`;
  }
}
