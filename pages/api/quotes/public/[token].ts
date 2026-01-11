// pages/api/quotes/public/[token].ts
// Updated: 2025-01-09 - Public quote endpoint with view tracking and template support for external website
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  const { token } = req.query;
  
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid token' });
  }

  if (req.method === 'GET') {
    return await getPublicQuote(req, res, token);
  } else if (req.method === 'POST') {
    return await trackQuoteView(req, res, token);
  } else {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getPublicQuote(req: NextApiRequest, res: NextApiResponse, token: string) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Find quote by webLinkToken (FIXED: was webToken)
    const quote = await db.collection('quotes').findOne({
      webLinkToken: token
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found or link expired' });
    }

    // Check if quote has expired
    if (quote.webLinkExpiry && new Date(quote.webLinkExpiry) < new Date()) {
      // Emit quote-expired automation event
      try {
        const { AutomationEventListener } = await import('../../../../src/services/automationEventListener');
        const automationEventListener = new AutomationEventListener(db);
        await automationEventListener.emitQuoteExpired(quote);
      } catch (error) {
        console.error('[Public Quote] Failed to emit quote-expired event:', error);
        // Don't fail the request if automation event fails
      }
      
      return res.status(410).json({ error: 'Quote link has expired' });
    }

    // Check if quote is published (required for public access)
    if (quote.status !== 'published' && quote.status !== 'presented' && quote.status !== 'accepted' && quote.status !== 'signed') {
      return res.status(403).json({ error: 'Quote is not publicly accessible' });
    }

    // NEW: Get template data
    let template = null;
    if (quote.templateId) {
      try {
        // Handle both ObjectId and string template IDs
        let templateQuery;
        try {
          templateQuery = { _id: new ObjectId(quote.templateId) };
        } catch {
          templateQuery = { _id: quote.templateId };
        }
        
        template = await db.collection('templates').findOne(templateQuery);
        
        // Fallback to saved snapshot if template was deleted/modified
        if (!template && quote.templateSnapshot) {
          template = quote.templateSnapshot;
          console.log('[Public Quote] Using template snapshot as fallback');
        }
      } catch (templateError) {
        console.error('[Public Quote] Error fetching template:', templateError);
        if (quote.templateSnapshot) {
          template = quote.templateSnapshot;
        }
      }
    } else if (quote.templateSnapshot) {
      // Legacy support - use snapshot if no templateId
      template = quote.templateSnapshot;
    }

    // Get location info for company branding
    const location = await db.collection('locations').findOne({
      locationId: quote.locationId
    });

    // Get contact info if available
    let contact = null;
    if (quote.contactId) {
      contact = await db.collection('contacts').findOne({
        _id: quote.contactId
      });
    }

    // Get project info if available
    let project = null;
    if (quote.projectId) {
      project = await db.collection('projects').findOne({
        _id: quote.projectId
      });
    }

    // Prepare public quote data (remove sensitive fields)
    const publicQuote = {
      _id: quote._id,
      quoteNumber: quote.quoteNumber,
      title: quote.title,
      description: quote.description,
      sections: quote.sections || [],
      subtotal: quote.subtotal || 0,
      taxRate: quote.taxRate || 0,
      taxAmount: quote.taxAmount || 0,
      discountPercentage: quote.discountPercentage || 0,
      discountAmount: quote.discountAmount || 0,
      total: quote.total || 0,
      depositType: quote.depositType,
      depositValue: quote.depositValue,
      depositAmount: quote.depositAmount,
      termsAndConditions: quote.termsAndConditions,
      paymentTerms: quote.paymentTerms,
      notes: quote.notes,
      status: quote.status,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
      validUntil: quote.validUntil,
      templateId: quote.templateId, // NEW: Include templateId
      // View stats (non-sensitive)
      totalViews: quote.totalViews || 0,
      lastViewedAt: quote.lastViewedAt,
    };

    // Company info for branding (enhanced with template overrides)
    const baseCompanyInfo = {
      name: location?.name || location?.business?.name || 'Company',
      phone: location?.phone || location?.business?.phone,
      email: location?.email || location?.business?.email,
      website: location?.website || location?.business?.website,
      address: location?.address || location?.business?.address,
      city: location?.city || location?.business?.city,
      state: location?.state || location?.business?.state,
      postalCode: location?.postalCode || location?.business?.postalCode,
      logoUrl: location?.business?.logoUrl,
    };

    // NEW: Merge with template company overrides if available
    const companyInfo = template?.companyOverrides ? {
      ...baseCompanyInfo,
      // Apply template overrides only if they exist and aren't null
      ...(template.companyOverrides.name && { name: template.companyOverrides.name }),
      ...(template.companyOverrides.logo && { logoUrl: template.companyOverrides.logo }),
      ...(template.companyOverrides.phone && { phone: template.companyOverrides.phone }),
      ...(template.companyOverrides.email && { email: template.companyOverrides.email }),
      ...(template.companyOverrides.address && { address: template.companyOverrides.address }),
      // Add template-specific fields
      tagline: template.companyOverrides.tagline,
      establishedYear: template.companyOverrides.establishedYear,
      warrantyYears: template.companyOverrides.warrantyYears,
    } : baseCompanyInfo;

    // Customer info (if available and not sensitive)
    const customerInfo = contact ? {
      name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.companyName,
      companyName: contact.companyName,
      // Only include public contact info if needed
    } : null;

    // Project info (if available)
    const projectInfo = project ? {
      title: project.title,
      description: project.description,
    } : null;

    // NEW: Include template data in response
    const responseData = {
      success: true,
      quote: publicQuote,
      company: companyInfo,
      customer: customerInfo,
      project: projectInfo,
      ...(template && { template: template }), // Include full template data if available
    };

    console.log(`[Public Quote] Quote ${quote.quoteNumber} accessed via token${template ? ` with template ${template.name || 'Unknown'}` : ''}`);

    res.status(200).json(responseData);

  } catch (err) {
    console.error('❌ Failed to get public quote:', err);
    res.status(500).json({ error: 'Failed to retrieve quote' });
  }
}

async function trackQuoteView(req: NextApiRequest, res: NextApiResponse, token: string) {
  try {
    const { 
      userAgent, 
      ipAddress, 
      deviceType, 
      timestamp,
      referrer,
      sessionId,
    } = req.body;

    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Verify quote exists (FIXED: was webToken)
    const quote = await db.collection('quotes').findOne({
      webLinkToken: token
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Parse user agent to get device info
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(userAgent || '');
    const isTablet = /iPad|Tablet/i.test(userAgent || '');
    
    let deviceCategory = 'desktop';
    if (isTablet) {
      deviceCategory = 'tablet';
    } else if (isMobile) {
      deviceCategory = 'mobile';
    }

    // Create view record
    const viewRecord = {
      quoteId: quote._id,
      quoteNumber: quote.quoteNumber,
      locationId: quote.locationId,
      webLinkToken: token,
      timestamp: new Date(timestamp) || new Date(),
      userAgent: userAgent,
      ipAddress: ipAddress,
      deviceType: deviceType || deviceCategory,
      deviceCategory: deviceCategory,
      referrer: referrer,
      sessionId: sessionId,
      createdAt: new Date(),
    };

    // Insert view record
    await db.collection('quote_views').insertOne(viewRecord);

    // Update quote with view count and last viewed
    await db.collection('quotes').updateOne(
      { _id: quote._id },
      { 
        $inc: { totalViews: 1 },
        $set: { lastViewedAt: new Date() }
      }
    );

    // Only emit quote-viewed automation event for actual customer views, not PDF generation
    const isPdfGeneration = req.body.source === 'pdf' || req.body.isPdfGeneration === true || 
                            userAgent?.includes('puppeteer') || userAgent?.includes('headless') ||
                            userAgent?.includes('chrome-headless') || deviceType === 'pdf-generator';
    
    if (!isPdfGeneration) {
      // Emit quote-viewed automation event for genuine customer views
      try {
        const { AutomationEventListener } = await import('../../../../src/services/automationEventListener');
        const automationEventListener = new AutomationEventListener(db);
        await automationEventListener.emitQuoteViewed({
          ...quote,
          totalViews: (quote.totalViews || 0) + 1,
          lastViewedAt: new Date()
        });
        console.log('[Public Quote] Quote-viewed automation event triggered');
      } catch (automationError) {
        console.error('[Public Quote] Failed to trigger quote-viewed automation:', automationError);
      }
    } else {
      console.log('[Public Quote] Skipping automation event - PDF generation or headless browser detected');
    }

    console.log(`[Public Quote] View tracked for quote ${quote.quoteNumber} from ${deviceCategory} device`);

    res.status(200).json({
      success: true,
      message: 'View tracked successfully',
    });

  } catch (err) {
    console.error('❌ Failed to track quote view:', err);
    res.status(500).json({ error: 'Failed to track view' });
  }
}

// Additional endpoint to get view analytics
export async function getQuoteAnalytics(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Get quote (FIXED: was webToken)
    const quote = await db.collection('quotes').findOne({
      webLinkToken: token
    });
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Get view analytics
    const views = await db.collection('quote_views')
      .find({ quoteId: quote._id })
      .sort({ timestamp: -1 })
      .toArray();

    // Aggregate analytics
    const analytics = {
      totalViews: views.length,
      uniqueViews: new Set(views.map(v => v.sessionId || v.ipAddress)).size,
      deviceBreakdown: {
        mobile: views.filter(v => v.deviceCategory === 'mobile').length,
        tablet: views.filter(v => v.deviceCategory === 'tablet').length,
        desktop: views.filter(v => v.deviceCategory === 'desktop').length,
      },
      firstViewedAt: views.length > 0 ? views[views.length - 1].timestamp : null,
      lastViewedAt: views.length > 0 ? views[0].timestamp : null,
      viewsByDay: getViewsByDay(views),
    };

    res.status(200).json({
      success: true,
      analytics: analytics,
      recentViews: views.slice(0, 10), // Last 10 views
    });

  } catch (err) {
    console.error('❌ Failed to get quote analytics:', err);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
}

function getViewsByDay(views: any[]) {
  const viewsByDay: { [key: string]: number } = {};
  
  views.forEach(view => {
    const date = new Date(view.timestamp).toISOString().split('T')[0];
    viewsByDay[date] = (viewsByDay[date] || 0) + 1;
  });
  
  return viewsByDay;
}