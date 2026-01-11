// src/services/templatePdfGenerator.ts
// PDF Generator that converts your block-based templates into beautiful PDFs

import { Document, Page, Text, View, StyleSheet, pdf, Image } from '@react-pdf/renderer';
import { createElement } from 'react';

// PDF Styles based on your web template styling
const createStyles = (primaryColor: string, accentColor: string) => StyleSheet.create({
  page: {
    flexDirection: 'column',
    backgroundColor: '#ffffff',
    padding: 30,
    fontSize: 11,
    fontFamily: 'Helvetica',
    lineHeight: 1.4,
  },
  
  // Header styles
  hero: {
    backgroundColor: primaryColor,
    color: 'white',
    padding: 25,
    marginBottom: 20,
    borderRadius: 8,
    textAlign: 'center',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    opacity: 0.9,
  },
  heroIcon: {
    fontSize: 32,
    marginBottom: 10,
  },

  // Quote header
  quoteHeader: {
    backgroundColor: '#f8f9fa',
    padding: 20,
    borderRadius: 8,
    marginBottom: 20,
  },
  quoteTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: primaryColor,
    marginBottom: 5,
  },
  quoteSubtitle: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 10,
  },
  customerLabel: {
    fontSize: 12,
    color: '#888888',
  },

  // Benefit cards
  benefitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  benefitCard: {
    width: '48%',
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    border: `1px solid #e9ecef`,
  },
  benefitIcon: {
    fontSize: 24,
    marginBottom: 8,
    textAlign: 'center',
  },
  benefitTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: primaryColor,
    marginBottom: 4,
    textAlign: 'center',
  },
  benefitSubtitle: {
    fontSize: 10,
    color: accentColor,
    marginBottom: 6,
    textAlign: 'center',
  },
  benefitDescription: {
    fontSize: 9,
    color: '#666666',
    textAlign: 'center',
  },

  // Process steps
  processSteps: {
    marginBottom: 20,
  },
  processStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
    paddingBottom: 10,
    borderBottom: '1px solid #e9ecef',
  },
  stepNumber: {
    width: 30,
    height: 30,
    backgroundColor: primaryColor,
    color: 'white',
    borderRadius: 15,
    textAlign: 'center',
    lineHeight: 2,
    fontSize: 12,
    fontWeight: 'bold',
    marginRight: 15,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 3,
  },
  stepTime: {
    fontSize: 10,
    color: accentColor,
    marginBottom: 5,
  },
  stepDescription: {
    fontSize: 10,
    color: '#666666',
  },

  // Contact info
  contactInfo: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  contactTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: primaryColor,
    marginBottom: 10,
    textAlign: 'center',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  contactIcon: {
    fontSize: 12,
    marginRight: 8,
    width: 20,
  },
  contactLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#333333',
    marginRight: 5,
  },
  contactValue: {
    fontSize: 10,
    color: '#666666',
  },

  // Quote breakdown
  quoteBreakdown: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: primaryColor,
    marginBottom: 15,
    borderBottom: `2px solid ${primaryColor}`,
    paddingBottom: 5,
  },
  
  // Line items table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: primaryColor,
    color: 'white',
    padding: 10,
    fontSize: 11,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '1px solid #e9ecef',
    padding: 8,
    minHeight: 25,
  },
  tableRowAlt: {
    backgroundColor: '#f8f9fa',
  },
  
  // Table cells
  descriptionCell: { flex: 3, paddingRight: 10 },
  qtyCell: { flex: 1, textAlign: 'center' },
  priceCell: { flex: 1.5, textAlign: 'right' },
  totalCell: { flex: 1.5, textAlign: 'right' },

  // Item details
  itemName: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#333333',
  },
  itemDescription: {
    fontSize: 9,
    color: '#666666',
    marginTop: 2,
  },

  // Section totals
  sectionTotal: {
    backgroundColor: '#f1f3f4',
    padding: 8,
    borderTop: '2px solid #e9ecef',
  },
  sectionTotalText: {
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'right',
    color: '#333333',
  },

  // Final totals
  totalsSection: {
    marginTop: 20,
    marginLeft: '60%',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
    borderBottom: '1px solid #e9ecef',
  },
  totalLabel: {
    fontSize: 11,
    color: '#333333',
  },
  totalValue: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#333333',
  },
  finalTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: primaryColor,
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
    borderRadius: 4,
  },

  // Warranty cards
  warrantyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  warrantyCard: {
    width: '32%',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 6,
    marginBottom: 10,
    textAlign: 'center',
  },

  // Service list
  serviceList: {
    marginBottom: 20,
  },
  serviceItem: {
    fontSize: 10,
    color: '#333333',
    marginBottom: 4,
    paddingLeft: 5,
  },

  // Scope list
  scopeList: {
    marginBottom: 20,
  },
  scopeItem: {
    fontSize: 10,
    color: '#333333',
    marginBottom: 6,
    paddingLeft: 10,
  },

  // Specifications
  specifications: {
    marginBottom: 20,
  },
  specSection: {
    marginBottom: 15,
  },
  specTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: primaryColor,
    marginBottom: 8,
  },
  specItem: {
    fontSize: 9,
    color: '#666666',
    marginBottom: 3,
    paddingLeft: 10,
  },

  // Text section
  textSection: {
    marginBottom: 20,
  },
  textContent: {
    fontSize: 10,
    color: '#333333',
    lineHeight: 1.5,
  },

  // Terms section
  termsSection: {
    backgroundColor: '#f8f9fa',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  termsTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: primaryColor,
    marginBottom: 10,
  },
  termsContent: {
    fontSize: 9,
    color: '#333333',
    lineHeight: 1.6,
  },

  // Signatures
  signaturesSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 30,
  },
  signatureBox: {
    width: '45%',
    minHeight: 80,
    border: '1px solid #cccccc',
    padding: 10,
    borderRadius: 4,
  },
  signatureImage: {
    width: '100%',
    height: 60,
    objectFit: 'contain',
  },
  signatureLabel: {
    fontSize: 8,
    color: '#666666',
    marginTop: 5,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 8,
    color: '#999999',
    borderTop: '1px solid #e9ecef',
    paddingTop: 10,
  },
});

// Block renderer functions
const renderBlock = (block: any, styles: any, variables: any, quote: any) => {
  const replaceVariables = (text: string): string => {
    let result = text;
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{${key}}`, 'g');
      result = result.replace(regex, String(value || ''));
    });
    return result;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  switch (block.type) {
    case 'hero':
      return createElement(View, { style: styles.hero, key: block.id }, [
        block.content.icon ? createElement(Text, { style: styles.heroIcon, key: 'icon' }, block.content.icon) : null,
        createElement(Text, { style: styles.heroTitle, key: 'title' }, replaceVariables(block.content.title)),
        block.content.subtitle ? createElement(Text, { style: styles.heroSubtitle, key: 'subtitle' }, replaceVariables(block.content.subtitle)) : null,
      ].filter(Boolean));

    case 'quote_header':
      return createElement(View, { style: styles.quoteHeader, key: block.id }, [
        createElement(Text, { style: styles.quoteTitle, key: 'title' }, replaceVariables(block.content.title)),
        block.content.subtitle ? createElement(Text, { style: styles.quoteSubtitle, key: 'subtitle' }, replaceVariables(block.content.subtitle)) : null,
        block.content.customerLabel ? createElement(Text, { style: styles.customerLabel, key: 'customer' }, replaceVariables(block.content.customerLabel)) : null,
      ].filter(Boolean));

    case 'benefit_cards':
      return createElement(View, { style: styles.benefitGrid, key: block.id }, 
        block.content.cards.map((card: any, index: number) => 
          createElement(View, { style: styles.benefitCard, key: index }, [
            createElement(Text, { style: styles.benefitIcon, key: 'icon' }, card.icon),
            createElement(Text, { style: styles.benefitTitle, key: 'title' }, replaceVariables(card.title)),
            card.subtitle ? createElement(Text, { style: styles.benefitSubtitle, key: 'subtitle' }, replaceVariables(card.subtitle)) : null,
            createElement(Text, { style: styles.benefitDescription, key: 'desc' }, replaceVariables(card.description)),
          ].filter(Boolean))
        )
      );

    case 'process_steps':
      return createElement(View, { style: styles.processSteps, key: block.id }, 
        block.content.steps.map((step: any, index: number) => 
          createElement(View, { style: styles.processStep, key: index }, [
            createElement(Text, { style: styles.stepNumber, key: 'number' }, step.stepNumber.toString()),
            createElement(View, { style: styles.stepContent, key: 'content' }, [
              createElement(Text, { style: styles.stepTitle, key: 'title' }, step.title),
              step.time ? createElement(Text, { style: styles.stepTime, key: 'time' }, step.time) : null,
              createElement(Text, { style: styles.stepDescription, key: 'desc' }, step.description),
            ].filter(Boolean)),
          ])
        )
      );

    case 'contact_info':
      return createElement(View, { style: styles.contactInfo, key: block.id }, [
        createElement(Text, { style: styles.contactTitle, key: 'title' }, block.content.title),
        ...block.content.items.map((item: any, index: number) => 
          createElement(View, { style: styles.contactItem, key: index }, [
            createElement(Text, { style: styles.contactIcon, key: 'icon' }, item.icon),
            createElement(Text, { style: styles.contactLabel, key: 'label' }, `${item.label}:`),
            createElement(Text, { style: styles.contactValue, key: 'value' }, replaceVariables(item.value)),
          ])
        ),
      ]);

    case 'quote_breakdown':
      return createElement(View, { style: styles.quoteBreakdown, key: block.id }, [
        createElement(Text, { style: styles.sectionTitle, key: 'title' }, block.content.title),
        
        // Render each section
        ...quote.sections.map((section: any, sectionIndex: number) => [
          // Section header
          createElement(Text, { 
            style: { ...styles.sectionTitle, fontSize: 14, marginBottom: 10, marginTop: sectionIndex > 0 ? 20 : 0 }, 
            key: `section-title-${sectionIndex}` 
          }, section.name),
          
          // Table header
          createElement(View, { style: styles.tableHeader, key: `header-${sectionIndex}` }, [
            createElement(Text, { style: styles.descriptionCell, key: 'desc-header' }, 'Description'),
            createElement(Text, { style: styles.qtyCell, key: 'qty-header' }, 'Qty'),
            createElement(Text, { style: styles.priceCell, key: 'price-header' }, 'Unit Price'),
            createElement(Text, { style: styles.totalCell, key: 'total-header' }, 'Total'),
          ]),
          
          // Line items
          ...section.lineItems.map((item: any, itemIndex: number) => 
            createElement(View, { 
              style: [styles.tableRow, itemIndex % 2 === 1 ? styles.tableRowAlt : {}], 
              key: `item-${sectionIndex}-${itemIndex}` 
            }, [
              createElement(View, { style: styles.descriptionCell, key: 'desc' }, [
                createElement(Text, { style: styles.itemName, key: 'name' }, item.name),
                item.description ? createElement(Text, { style: styles.itemDescription, key: 'desc-text' }, item.description) : null,
              ].filter(Boolean)),
              createElement(Text, { style: styles.qtyCell, key: 'qty' }, item.quantity.toString()),
              createElement(Text, { style: styles.priceCell, key: 'price' }, formatCurrency(item.unitPrice)),
              createElement(Text, { style: styles.totalCell, key: 'total' }, formatCurrency(item.totalPrice)),
            ])
          ),
          
          // Section total
          createElement(View, { style: styles.sectionTotal, key: `section-total-${sectionIndex}` }, 
            createElement(Text, { style: styles.sectionTotalText, key: 'total-text' }, 
              `${section.name} Total: ${formatCurrency(section.subtotal)}`
            )
          ),
        ]).flat(),
        
        // Final totals
        createElement(View, { style: styles.totalsSection, key: 'totals' }, [
          createElement(View, { style: styles.totalRow, key: 'subtotal' }, [
            createElement(Text, { style: styles.totalLabel, key: 'label' }, 'Subtotal:'),
            createElement(Text, { style: styles.totalValue, key: 'value' }, formatCurrency(quote.subtotal)),
          ]),
          quote.taxAmount > 0 ? createElement(View, { style: styles.totalRow, key: 'tax' }, [
            createElement(Text, { style: styles.totalLabel, key: 'label' }, 'Tax:'),
            createElement(Text, { style: styles.totalValue, key: 'value' }, formatCurrency(quote.taxAmount)),
          ]) : null,
          quote.discountAmount > 0 ? createElement(View, { style: styles.totalRow, key: 'discount' }, [
            createElement(Text, { style: styles.totalLabel, key: 'label' }, 'Discount:'),
            createElement(Text, { style: styles.totalValue, key: 'value' }, `-${formatCurrency(quote.discountAmount)}`),
          ]) : null,
          createElement(View, { style: styles.finalTotal, key: 'final' }, [
            createElement(Text, { key: 'label' }, 'TOTAL:'),
            createElement(Text, { key: 'value' }, formatCurrency(quote.total)),
          ]),
        ].filter(Boolean)),
      ]);

    case 'warranty_cards':
      return createElement(View, { style: styles.warrantyGrid, key: block.id }, 
        block.content.cards.map((card: any, index: number) => 
          createElement(View, { style: styles.warrantyCard, key: index }, [
            createElement(Text, { style: styles.benefitIcon, key: 'icon' }, card.icon),
            createElement(Text, { style: styles.benefitTitle, key: 'title' }, replaceVariables(card.title)),
            card.subtitle ? createElement(Text, { style: styles.benefitSubtitle, key: 'subtitle' }, replaceVariables(card.subtitle)) : null,
            createElement(Text, { style: styles.benefitDescription, key: 'desc' }, replaceVariables(card.description)),
          ].filter(Boolean))
        )
      );

    case 'service_list':
      return createElement(View, { style: styles.serviceList, key: block.id }, [
        createElement(Text, { style: styles.sectionTitle, key: 'title' }, replaceVariables(block.content.title)),
        ...block.content.items.map((item: string, index: number) => 
          createElement(Text, { style: styles.serviceItem, key: index }, replaceVariables(item))
        ),
      ]);

    case 'scope_list':
      return createElement(View, { style: styles.scopeList, key: block.id }, [
        createElement(Text, { style: styles.sectionTitle, key: 'title' }, block.content.title),
        ...block.content.items.map((item: string, index: number) => 
          createElement(Text, { style: styles.scopeItem, key: index }, item)
        ),
      ]);

    case 'specifications':
      return createElement(View, { style: styles.specifications, key: block.id }, 
        block.content.specs.map((spec: any, index: number) => 
          createElement(View, { style: styles.specSection, key: index }, [
            createElement(Text, { style: styles.specTitle, key: 'title' }, spec.title),
            ...spec.items.map((item: string, itemIndex: number) => 
              createElement(Text, { style: styles.specItem, key: itemIndex }, item)
            ),
          ])
        )
      );

    case 'text_section':
      return createElement(View, { style: styles.textSection, key: block.id }, [
        createElement(Text, { style: styles.sectionTitle, key: 'title' }, block.content.title),
        createElement(Text, { style: styles.textContent, key: 'content' }, replaceVariables(block.content.content)),
      ]);

    case 'terms_section':
      return createElement(View, { style: styles.termsSection, key: block.id }, [
        createElement(Text, { style: styles.termsTitle, key: 'title' }, block.content.title),
        createElement(Text, { style: styles.termsContent, key: 'content' }, replaceVariables(block.content.content)),
      ]);

    default:
      return null;
  }
};

// Main PDF Document Component
const QuoteTemplatePDF = ({ quote, template, variables, signatures }: any) => {
  const styles = createStyles(template.styling.primaryColor, template.styling.accentColor);
  
  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Get enabled tabs sorted by order
  const enabledTabs = template.tabs
    .filter((tab: any) => tab.enabled)
    .sort((a: any, b: any) => a.order - b.order);

  return createElement(Document, {
    title: `Quote ${quote.quoteNumber}`,
    subject: `Quote for ${quote.title}`,
    author: variables.companyName,
    creator: 'LPai App',
  }, 
    enabledTabs.map((tab: any, tabIndex: number) => 
      createElement(Page, {
        size: 'A4',
        style: styles.page,
        key: `page-${tabIndex}`,
      }, [
        // Tab content blocks
        ...tab.blocks
          .sort((a: any, b: any) => a.position - b.position)
          .map((block: any) => renderBlock(block, styles, variables, quote))
          .filter(Boolean),

        // Add signatures on the last page if quote is signed
        ...(tabIndex === enabledTabs.length - 1 && quote.signatures?.customer ? [
          createElement(View, { style: styles.signaturesSection, key: 'signatures' }, [
            createElement(View, { style: styles.signatureBox, key: 'customer-sig' }, [
              createElement(Text, { style: styles.sectionTitle, key: 'title' }, 'Customer Signature'),
              quote.signatures.customer ? 
                createElement(Image, { 
                  style: styles.signatureImage, 
                  src: quote.signatures.customer,
                  key: 'sig-img'
                }) : null,
              createElement(Text, { style: styles.signatureLabel, key: 'label' }, 
                `Signed: ${formatDate(quote.signatures.customer ? quote.signedAt : new Date())}`
              ),
              createElement(Text, { style: styles.signatureLabel, key: 'name' }, 
                `Name: ${variables.customerName}`
              ),
            ].filter(Boolean)),
          ]),
        ] : []),

        // Footer
        createElement(Text, { style: styles.footer, key: 'footer' }, 
          `Generated on ${formatDate(new Date())} | Quote ${quote.quoteNumber} | Page ${tabIndex + 1} of ${enabledTabs.length}`
        ),
      ])
    )
  );
};

class TemplatePDFGenerator {
  /**
   * Generate PDF from your template structure
   */
  async generateTemplatePDF(
    quote: any,
    template: any,
    variables: any,
    signatures: any = {}
  ): Promise<Buffer> {
    console.log('[Template PDF Generator] Generating PDF for quote:', quote.quoteNumber);

    try {
      // Create the PDF document using your template structure
      const pdfDocument = QuoteTemplatePDF({ quote, template, variables, signatures });
      
      // Generate PDF buffer
      const pdfBuffer = await pdf(pdfDocument).toBuffer();
      
      console.log('[Template PDF Generator] PDF generated successfully:', {
        size: pdfBuffer.length,
        pages: template.tabs.filter((tab: any) => tab.enabled).length,
        quoteNumber: quote.quoteNumber
      });

      return pdfBuffer;

    } catch (error) {
      console.error('[Template PDF Generator] Error generating PDF:', error);
      throw new Error(`Failed to generate template PDF: ${error.message}`);
    }
  }

  /**
   * Build variables for template (same as your web version)
   */
  buildVariables(quote: any, company: any, template: any): Record<string, string> {
    const currentYear = new Date().getFullYear();
    const establishedYear = parseInt(
      template.companyOverrides?.establishedYear || 
      company.establishedYear || 
      currentYear.toString()
    );
    const experienceYears = currentYear - establishedYear;

    return {
      // Company variables
      companyName: template.companyOverrides?.name || company.name || 'Your Company',
      companyLogo: template.companyOverrides?.logo || company.logoUrl || '🏢',
      companyTagline: template.companyOverrides?.tagline || company.tagline || 'Professional service you can trust',
      phone: template.companyOverrides?.phone || company.phone || '',
      email: template.companyOverrides?.email || company.email || '',
      address: template.companyOverrides?.address || company.address || '',
      establishedYear: template.companyOverrides?.establishedYear || company.establishedYear || currentYear.toString(),
      warrantyYears: template.companyOverrides?.warrantyYears || company.warrantyYears || '1',
      experienceYears: experienceYears.toString(),
      
      // Quote variables
      quoteNumber: quote.quoteNumber || 'Q-XXXX-XXX',
      customerName: quote.customerName || 'Customer',
      projectTitle: quote.title || 'Project',
      totalAmount: `$${quote.total.toLocaleString()}`,
      subtotalAmount: `$${quote.subtotal.toLocaleString()}`,
      taxAmount: `$${(quote.taxAmount || 0).toLocaleString()}`,
      
      // Terms
      termsAndConditions: quote.termsAndConditions || 'Standard terms and conditions apply.',
      paymentTerms: quote.paymentTerms || 'Payment due upon completion.',
      notes: quote.notes || '',
      
      // Dates
      currentDate: new Date().toLocaleDateString(),
      quoteDate: quote.createdAt ? new Date(quote.createdAt).toLocaleDateString() : new Date().toLocaleDateString(),
      validUntil: quote.validUntil ? new Date(quote.validUntil).toLocaleDateString() : 'Please inquire',
    };
  }
}

export const templatePDFGenerator = new TemplatePDFGenerator();