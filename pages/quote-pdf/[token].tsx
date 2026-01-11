/**
 * File: quote-pdf/[token].tsx
 * Purpose: PDF-optimized quote page for Puppeteer generation
 * Author: LPai Team
 * Last Modified: 2025-09-03
 * Dependencies: BlockRenderer, quote API
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import BlockRenderer from '../../src/utils/BlockRenderer';

// Add this function inside the component:
const getPublicQuote = async (token: string) => {
  const response = await fetch(`/api/quotes/public/${token}`);
  if (!response.ok) throw new Error('Quote not found');
  return response.json();
};

// Cloudflare Images helper
const getOptimizedImageUrl = (logoUrl: string) => {
  if (logoUrl.includes('imagedelivery.net')) {
    const baseUrl = logoUrl.split('/w=')[0];
    return `${baseUrl}/w=144,h=72,fit=contain`;
  }
  if (logoUrl.startsWith('http')) {
    return logoUrl;
  }
  const CLOUDFLARE_ACCOUNT_HASH = process.env.NEXT_PUBLIC_CLOUDFLARE_IMAGES_HASH || 'your-account-hash';
  return `https://imagedelivery.net/${CLOUDFLARE_ACCOUNT_HASH}/${logoUrl}/w=144,h=72,fit=contain`;
};

interface QuoteData {
  quote: any;
  company: any;
  customer: any;
  project: any;
  template: any;
}

export default function PDFQuotePage() {
  const router = useRouter();
  const { token } = router.query;
  const tokenString = Array.isArray(token) ? token[0] : token;
  
  const [quoteData, setQuoteData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    if (tokenString) {
      loadQuote(tokenString);
    }
  }, [tokenString]);

  const loadQuote = async (quoteToken: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await getPublicQuote(quoteToken);
      setQuoteData(data);
    } catch (err: any) {
      console.error('Failed to load quote:', err);
      setError(err.message || 'Failed to load quote');
    } finally {
      setLoading(false);
    }
  };

  const buildVariables = (): Record<string, string> => {
    if (!quoteData) return {};

    const { quote, company } = quoteData;
    
    console.log('[PDF Variables] Company data:', {
      companyPhone: company.phone,
      companyEmail: company.email,
      templateOverrides: quoteData.template?.companyOverrides
    });

    const currentYear = new Date().getFullYear();
    const establishedYear = parseInt(
      quoteData.template?.companyOverrides?.establishedYear || 
      company.establishedYear || 
      currentYear.toString()
    );
    const experienceYears = currentYear - establishedYear;

    const variables = {
      companyName: quoteData.template?.companyOverrides?.name || company.name || 'Your Company',
      companyLogo: quoteData.template?.companyOverrides?.logo || company.logoUrl || '🏢',
      companyTagline: quoteData.template?.companyOverrides?.tagline || company.tagline || 'Professional service you can trust',
      phone: quoteData.template?.companyOverrides?.phone || company.phone || '',
      email: quoteData.template?.companyOverrides?.email || company.email || '',
      address: quoteData.template?.companyOverrides?.address || company.address || '',
      establishedYear: quoteData.template?.companyOverrides?.establishedYear || company.establishedYear || currentYear.toString(),
      warrantyYears: quoteData.template?.companyOverrides?.warrantyYears || company.warrantyYears || '1',
      experienceYears: experienceYears.toString(),
      quoteNumber: quote.quoteNumber || 'Q-XXXX-XXX',
      customerName: quoteData.customer?.name || 'Customer',
      projectTitle: quoteData.project?.title || quote.title || 'Project',
      totalAmount: `$${quote.total.toLocaleString()}`,
      termsAndConditions: quote.termsAndConditions || '',
      paymentTerms: quote.paymentTerms || '',
      notes: quote.notes || '',
    };

    console.log('[PDF Variables] Final variables:', variables);
    return variables;
  };

  const replaceVariables = (text: string, variables: Record<string, string>): string => {
    let result = text;
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{${key}}`, 'g');
      result = result.replace(regex, value || `{${key}}`);
    });
    return result;
  };

  const getEnabledTabs = () => {
    if (!quoteData?.template?.tabs || !Array.isArray(quoteData.template.tabs)) {
      return [];
    }
    
    return quoteData.template.tabs
      .filter((tab: any) => tab && tab.enabled === true)
      .sort((a: any, b: any) => (a?.order || 0) - (b?.order || 0));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading quote...</p>
        </div>
      </div>
    );
  }

  if (error || !quoteData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md mx-auto p-4">
          <div className="text-red-500 text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Quote Not Available</h1>
          <p className="text-gray-600">{error || 'No quote data available'}</p>
        </div>
      </div>
    );
  }

  const { quote, company, template } = quoteData;
  const variables = buildVariables();
  const enabledTabs = getEnabledTabs();

  // Fallback if no template
  if (!template || enabledTabs.length === 0) {
    return (
      <div>
        <Head>
          <title>Quote PDF - {quote.quoteNumber}</title>
          <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />
        </Head>
        <div className="min-h-screen bg-white p-4">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">{company.name}</h1>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">{quote.title}</h2>
            <p className="text-xl text-blue-600 font-bold">${quote.total.toLocaleString()}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Head>
        <title>Quote PDF - {quote.quoteNumber}</title>
        <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />
        <style jsx global>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
          
          * {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            box-sizing: border-box;
          }
          
          @media print {
            body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; }
            .tab-section { 
              page-break-before: always; 
              page-break-inside: avoid;
              margin-top: 0 !important;
              padding-top: 0 !important;
            }
            .tab-section:first-child { 
              page-break-before: avoid; 
            }
            .hero-section {
              margin-top: 0 !important;
              padding-top: 8px !important;
            }
          }
          
          @page {
            margin: 0.75in;
            size: letter;
          }
          
          .quote-breakdown-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0;
          }
          
          .quote-breakdown-table th,
          .quote-breakdown-table td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
          }
          
          .quote-breakdown-table th {
            font-weight: 600;
            background-color: rgba(46, 134, 171, 0.1);
            font-size: 14px;
          }
          
          .quote-breakdown-table td {
            font-size: 13px;
          }
        `}</style>
      </Head>
      
      <div className="bg-white min-h-screen">
        {/* PDF Print Styles */}
        <style jsx>{`
          /* Custom styles for PDF-specific elements */
          .tab-divider {
            background-color: ${template.styling.accentColor};
          }
          
          .enhanced-footer {
            border-top-color: ${template.styling.primaryColor};
          }
          
          .footer-title {
            color: ${template.styling.primaryColor};
          }
        `}</style>

        <div className="pdf-container w-full bg-white text-gray-900 text-sm leading-relaxed">
          {/* Content Section - no separate header needed */}
          <main className="px-8 pt-2 pb-6">
            {enabledTabs.map((tab: any, index: number) => (
              <section 
                key={tab.id} 
                className={`tab-section mb-6 ${index === 0 ? '' : 'page-break'}`}
              >
                {/* Tab Header with Tailwind */}
                <div className="mb-3 pb-1 border-b border-gray-200">
                  <h2 className="text-lg font-bold mb-1 flex items-center gap-1" style={{ color: template.styling.primaryColor }}>
                    <span className="text-lg">{tab.icon}</span>
                    {replaceVariables(tab.title, variables)}
                  </h2>
                  <div 
                    className="tab-divider h-0.5 w-12 rounded-sm"
                  />
                </div>

                {/* Block Containers - Let BlockRenderer handle its own Tailwind styling */}
                <div className="space-y-2">
                  {tab.blocks
                    .sort((a: any, b: any) => a.position - b.position)
                    .map((block: any) => (
                      <div key={block.id} className="break-inside-avoid">
                        <BlockRenderer
                          block={block}
                          styling={template.styling}
                          variables={variables}
                          quote={quote}
                        />
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </main>

          {/* Professional Footer with Tailwind */}
          <footer className="enhanced-footer bg-gray-50 border-t-4 mt-6 py-3 px-6 text-center">
            <div>
              <p className="footer-title text-base font-semibold mb-2">Questions? We're Here to Help</p>
              <p className="text-sm text-gray-600 mb-4">Reply to this email or call us directly for any questions about your quote.</p>
              <div className="flex justify-center gap-3 flex-wrap">
                {company.phone && (
                  <div className="flex items-center gap-1 text-sm text-gray-700">
                    <span className="text-sm">📞</span>
                    <span>{company.phone}</span>
                  </div>
                )}
                {company.email && (
                  <div className="flex items-center gap-1 text-sm text-gray-700">
                    <span className="text-sm">✉️</span>
                    <span>{company.email}</span>
                  </div>
                )}
                {company.address && (
                  <div className="flex items-center gap-1 text-sm text-gray-700">
                    <span className="text-sm">📍</span>
                    <span>{company.address}</span>
                  </div>
                )}
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}