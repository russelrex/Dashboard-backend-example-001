// pages/api/quotes/[id].ts
// Fixed version with debug logging and simplified template handling
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import crypto from 'crypto';
import { publishAblyEvent } from '../../../src/utils/ably/publishEvent';
import ably from '@/lib/ably-server';
import { triggerQuoteAutomation, getAblyInstance, publishAblyEvent as publishAblyEventFromHelper } from '@/utils/automations/triggerHelper';

// Always log for debugging (removed conditional logging that was hiding errors)
const log = (...args: any[]) => {
  console.log('[QUOTE API]', ...args);
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  
  log('Handler called:', { method: req.method, id });
  
  if (!id || typeof id !== 'string') {
    log('Invalid ID provided:', id);
    return res.status(400).json({ error: 'Missing or invalid quote ID' });
  }

  const client = await clientPromise;
  const db = client.db(getDbName());

  switch (req.method) {
    case 'GET':
      return await getQuote(db, id, req.query, res);
    case 'PATCH':
      return await updateQuote(db, id, req.body, req, res);
    case 'DELETE':
      return await deleteQuote(db, id, req.query, req, res);
    default:
      res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

// 📋 GET: Fetch single quote with full details including template
async function getQuote(db: any, id: string, query: any, res: NextApiResponse) {
  try {
    const { locationId: rawLocationId } = query;
    const locationId = Array.isArray(rawLocationId) ? rawLocationId[0] : rawLocationId;
    
    log('getQuote called:', { id, locationId });
    
    if (!locationId) {
      log('Missing locationId in query');
      return res.status(400).json({ error: 'Missing locationId' });
    }
    
    if (!ObjectId.isValid(id)) {
      log('Invalid ObjectId format:', id);
      return res.status(400).json({ error: 'Invalid quote ID format' });
    }
    
    log('About to query database:', {
      _id: new ObjectId(id).toString(),
      locationId
    });
    
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(id),
      locationId
    });
    
    log('Database query result:', {
      found: !!quote,
      quoteId: quote?._id?.toString(),
      quoteLocationId: quote?.locationId,
      quoteNumber: quote?.quoteNumber
    });
    
    if (!quote) {
      log('Quote not found in database');
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Enrich with contact and project details
    try {
      log('Enriching quote with contact and project data...');
      
      const [contact, project] = await Promise.all([
        quote.contactId ? db.collection('contacts').findOne({ _id: new ObjectId(quote.contactId) }) : null,
        quote.projectId ? db.collection('projects').findOne({ _id: new ObjectId(quote.projectId) }) : null
      ]);
      
      log('Contact and project lookup results:', {
        contactFound: !!contact,
        projectFound: !!project,
        contactId: quote.contactId,
        projectId: quote.projectId
      });
      
      // Handle template data safely
      let template = null;
      try {
        if (quote.templateId) {
          log('Looking up template:', quote.templateId);
          template = await db.collection('templates').findOne({
            _id: quote.templateId
          });
          
          if (!template && quote.templateSnapshot) {
            log('Template not found, using snapshot');
            template = quote.templateSnapshot;
          }
        } else if (quote.templateSnapshot) {
          log('Using template snapshot (no templateId)');
          template = quote.templateSnapshot;
        }
        
        log('Template result:', {
          templateFound: !!template,
          templateName: template?.name,
          hasSnapshot: !!quote.templateSnapshot
        });
        
      } catch (templateError: any) {
        log('Error handling template, continuing without it:', templateError.message);
        // Don't fail the whole request if template lookup fails
        template = quote.templateSnapshot || null;
      }
      
      const enrichedQuote = {
        ...quote,
        contact,
        project,
        template, // Include template data if available
        contactName: contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown Contact',
        projectTitle: project?.title || 'Unknown Project',
      };
      
      log('Successfully enriched quote:', {
        quoteNumber: quote.quoteNumber,
        hasContact: !!contact,
        hasProject: !!project,
        hasTemplate: !!template
      });
      
      return res.status(200).json(enrichedQuote);
      
    } catch (enrichError: any) {
      log('Error enriching quote, returning basic quote:', enrichError.message);
      
      // If enrichment fails, return the basic quote
      const basicQuote = {
        ...quote,
        contactName: 'Unknown Contact',
        projectTitle: 'Unknown Project',
        template: quote.templateSnapshot || null
      };
      
      return res.status(200).json(basicQuote);
    }
    
  } catch (error: any) {
    log('Critical error in getQuote:', error);
    console.error('[QUOTE API] Critical error fetching quote:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch quote',
      details: error.message 
    });
  }
}

// ✏️ PATCH: Update quote with template support
async function updateQuote(db: any, id: string, body: any, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId, action, userId } = body;
    
    log('updateQuote called:', { id, action, locationId, userId });
    
    if (!locationId) {
      return res.status(400).json({ error: 'Missing locationId' });
    }
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid quote ID format' });
    }
    
    // Get existing quote first
    const existingQuote = await db.collection('quotes').findOne({
      _id: new ObjectId(id),
      locationId
    });
    
    if (!existingQuote) {
      log('Quote not found for update:', id);
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Check if quote is signed and prevent editing
    if (existingQuote.status === 'signed') {
      return res.status(400).json({
        success: false,
        error: 'Cannot edit signed quote',
        message: 'This quote has been signed and cannot be modified',
        status: existingQuote.status
      });
    }
    
    // Check if quote has expired
    if (existingQuote.validUntil && new Date(existingQuote.validUntil) < new Date()) {
      // Import and use automationEventListener to emit quote-expired event
      const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
      const automationEventListener = new AutomationEventListener(db);
      await automationEventListener.emitQuoteExpired(existingQuote);
    }
    
         let updateData: any = {};
     let activityEntry: any = null;
     let projectUpdate: any = null;
     let shouldUpdatePipelineStage = false;
     let newStatus = null;
     let changedFields: string[] = [];
     let previousTotal: number = 0;
    
    switch (action) {
      case 'update_status':
        const { status, signatureImageUrl, signedBy } = body;
        
        if (!status) {
          return res.status(400).json({ error: 'Status is required' });
        }
        
        // Valid statuses (note: 'sent' is deprecated - use 'published' + sentAt timestamp instead)
        const validStatuses = ['draft', 'published', 'presented', 'accepted', 'signed', 'declined', 'viewed'];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({ 
            error: `Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}` 
          });
        }
        
        updateData = {
          status,
          updatedAt: new Date().toISOString(),
        };
        
        newStatus = status;
        shouldUpdatePipelineStage = true;
        
        // Add status-specific timestamps
        if (status === 'sent') {
          // Note: 'sent' status is deprecated but still supported for backward compatibility
          // In the new workflow, use 'published' status and track email sending via sentAt timestamp
          updateData.sentAt = new Date().toISOString();
        } else if (status === 'viewed') {
          updateData.viewedAt = new Date().toISOString();
          updateData.lastViewedAt = new Date().toISOString();
          projectUpdate = {
            quoteViewedAt: new Date(),
            status: 'quote_viewed'
          };
          
          // Only emit quote-viewed event for actual web views, not in-person interactions
          // Check if this is from a web link view (has webLinkToken) vs in-person/manual update
          const isWebView = req.body.source === 'web' || req.body.fromWebLink === true;
          
          if (isWebView) {
            // Emit quote-viewed event for hot lead automation
            try {
              const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
              const automationEventListener = new AutomationEventListener(db);
              
              await automationEventListener.emitQuoteViewed(existingQuote);
            } catch (error) {
              console.error('Failed to emit quote-viewed:', error);
            }
          }
        } else if (status === 'accepted') {
          updateData.respondedAt = new Date().toISOString();
          
          // Check if this is an in-person signature vs web signature
          const isInPersonSignature = req.body.source === 'in-person' || req.body.inPerson === true;
          
          if (signatureImageUrl) {
            updateData.signatureImageUrl = signatureImageUrl;
            updateData.signedAt = new Date().toISOString();
            updateData.signedBy = signedBy || 'Customer';
            
            // Emit quote-signed event
            try {
              const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
              const automationEventListener = new AutomationEventListener(db);
              await automationEventListener.emitQuoteSigned(existingQuote);
            } catch (error) {
              console.error('Failed to emit quote-signed:', error);
            }
          }
          
          // Only emit quote-viewed for web-based acceptances, not in-person ones
          if (!isInPersonSignature) {
            updateData.viewedAt = new Date().toISOString();
            updateData.lastViewedAt = new Date().toISOString();
            projectUpdate = {
              quoteViewedAt: new Date(),
              status: 'quote_viewed'
            };
            
            // Emit quote-viewed event for web-based acceptances
            try {
              const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
              const automationEventListener = new AutomationEventListener(db);
              await automationEventListener.emitQuoteViewed(existingQuote);
            } catch (error) {
              console.error('Failed to emit quote-viewed:', error);
            }
          }
        } else if (status === 'declined') {
          updateData.respondedAt = new Date().toISOString();
          projectUpdate = {
            status: 'quote_declined',
            quoteDeclinedAt: new Date()
          };
        }
        
        activityEntry = {
          action: `status_changed_to_${status}`,
          timestamp: new Date().toISOString(),
          userId: userId || 'system',
          metadata: { 
            previousStatus: existingQuote.status,
            newStatus: status 
          }
        };
        
        log('Updating quote status:', { id, from: existingQuote.status, to: status });
        break;

      case 'mark_presented':
        const { presentedBy } = body;
        
        updateData = {
          status: 'presented',
          presentedAt: new Date(),
          presentedBy: presentedBy || userId || 'system',
          updatedAt: new Date(),
        };
        
        newStatus = 'presented';
        shouldUpdatePipelineStage = true;
        
        activityEntry = {
          action: 'marked_presented',
          timestamp: new Date().toISOString(),
          userId: userId || 'system',
          metadata: { 
            previousStatus: existingQuote.status,
            newStatus: 'presented' 
          }
        };
        
        // Emit quote-presented event for automation
        try {
          const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
          const automationEventListener = new AutomationEventListener(db);
          await automationEventListener.emitQuotePresented(existingQuote);
        } catch (error) {
          console.error('Failed to emit quote-presented:', error);
        }
        
        log('Marking quote as presented:', id);
        break;

      case 'track_email_sent':
        // Track when email is sent without changing status
        const { sentTo, emailId } = body;
        
        updateData = {
          sentAt: new Date().toISOString(),
          lastEmailSentAt: new Date().toISOString(),
          emailsSentCount: (existingQuote.emailsSentCount || 0) + 1,
          updatedAt: new Date().toISOString(),
        };
        
        activityEntry = {
          action: 'email_sent',
          timestamp: new Date().toISOString(),
          userId: userId || 'system',
          metadata: { 
            sentTo: sentTo || 'Unknown',
            emailId: emailId || 'Unknown',
            previousStatus: existingQuote.status // Keep current status
          }
        };
        
        // Emit quote-sent event
        try {
          const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
          const automationEventListener = new AutomationEventListener(db);
          await automationEventListener.emitQuoteSent(existingQuote);
        } catch (error) {
          console.error('Failed to emit quote-sent:', error);
        }
        
        log('Tracking email sent for quote:', id);
        break;

      case 'publish':
        const { publishedBy } = body;
        
        // Generate weblink token if not exists
        let webLinkToken = existingQuote.webLinkToken;
        if (!webLinkToken) {
          webLinkToken = crypto.randomBytes(32).toString('hex');
        }
        
        const webLinkExpiry = new Date();
        webLinkExpiry.setMonth(webLinkExpiry.getMonth() + 1); // 1 month expiry
        
        updateData = {
          status: 'published',
          publishedAt: new Date(),
          publishedBy: publishedBy || userId || 'system',
          webLinkToken: webLinkToken,
          webLinkExpiry: webLinkExpiry.toISOString(),
          updatedAt: new Date(),
        };
        
        newStatus = 'published';
        shouldUpdatePipelineStage = true;
        
        activityEntry = {
          action: 'published',
          timestamp: new Date().toISOString(),
          userId: userId || 'system',
          metadata: { 
            previousStatus: existingQuote.status,
            newStatus: 'published',
            webLinkToken: webLinkToken,
            expiryDate: webLinkExpiry.toISOString()
          }
        };
        
        log('Publishing quote:', { id, webLinkToken });
        
        // Emit quote-published event
        try {
          const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
          const automationEventListener = new AutomationEventListener(db);
          await automationEventListener.emitQuotePublished({...existingQuote, webLinkToken: webLinkToken});
        } catch (error) {
          console.error('Failed to emit quote-published:', error);
        }
        
        break;
        
      case 'update_content':
        const { 
          title, 
          description, 
          sections, 
          taxRate, 
          discountAmount, 
          discountPercentage,
          termsAndConditions,
          paymentTerms,
          notes,
          scopeOfWork,
          // EXISTING DEPOSIT FIELDS
          depositType,
          depositValue,
          depositAmount,
          // TEMPLATE FIELDS
          templateId,
          templateSnapshot,
          presentationSettings
        } = body;
        
        // Track what changed for notification
        changedFields.length = 0; // Reset for this update
        previousTotal = existingQuote.total;
        
        // Check if important fields changed
        if (sections && JSON.stringify(sections) !== JSON.stringify(existingQuote.sections)) {
          changedFields.push('Line items updated');
        }
        if (taxRate !== undefined && taxRate !== existingQuote.taxRate) {
          changedFields.push(`Tax rate changed from ${(existingQuote.taxRate || 0) * 100}% to ${taxRate * 100}%`);
        }
        if (discountPercentage !== undefined && discountPercentage !== existingQuote.discountPercentage) {
          changedFields.push(`Discount changed from ${existingQuote.discountPercentage || 0}% to ${discountPercentage}%`);
        }
        if (depositValue !== undefined && depositValue !== existingQuote.depositValue) {
          changedFields.push(`Deposit amount updated`);
        }
        
        // Handle template updates safely
        if (templateId !== undefined) {
          console.log(`[QUOTES API] Template update request:`, {
            quoteId: id,
            templateId,
            templateIdType: typeof templateId,
            currentTemplateId: existingQuote.templateId,
            templateChanged: templateId !== existingQuote.templateId
          });
          
          try {
            if (templateId) {
              // Verify template exists and user has access
              let templateQuery;
              try {
                templateQuery = { _id: new ObjectId(templateId) };
              } catch {
                templateQuery = { _id: templateId };
              }
              
              const template = await db.collection('templates').findOne({
                ...templateQuery,
                $or: [
                  { isGlobal: true },
                  { locationId: locationId }
                ]
              });
              
              console.log(`[QUOTES API] Template lookup result:`, {
                templateFound: !!template,
                templateName: template?.name,
                templateLocationId: template?.locationId,
                templateIsGlobal: template?.isGlobal,
                queryUsed: templateQuery
              });
              
              if (template) {
                updateData.templateId = templateId;
                // Update snapshot with fresh template data if not provided
                if (!templateSnapshot) {
                  updateData.templateSnapshot = {
                    name: template.name,
                    styling: template.styling,
                    companyOverrides: template.companyOverrides,
                    tabs: template.tabs
                  };
                }
                console.log(`[QUOTES API] Updated template:`, template.name);
                log('Updated template:', template.name);
              } else {
                console.log(`[QUOTES API] Template not found:`, templateId);
                log('Template not found:', templateId);
              }
            } else {
              // Remove template
              updateData.templateId = null;
              updateData.templateSnapshot = null;
              updateData.presentationSettings = null;
            }
          } catch (templateError: any) {
            log('Error updating template:', templateError.message);
            // Continue without template update
          }
        }
        
        if (templateSnapshot !== undefined) {
          updateData.templateSnapshot = templateSnapshot;
        }
        
        if (presentationSettings !== undefined) {
          updateData.presentationSettings = presentationSettings;
        }
        
        // Recalculate totals if sections provided
        if (sections) {
          const sectionsWithTotals = sections.map((section: any) => {
            const lineItems = section.lineItems || [];
            const sectionSubtotal = lineItems.reduce((sum: number, item: any) => {
              return sum + (parseFloat(item.totalPrice) || 0);
            }, 0);
            
            return {
              ...section,
              subtotal: sectionSubtotal,
            };
          });
          
          const subtotal = sectionsWithTotals.reduce((sum: number, section: any) => sum + section.subtotal, 0);
          const discountTotal = discountPercentage > 0 
            ? subtotal * (discountPercentage / 100)
            : discountAmount || 0;
          const taxableAmount = subtotal - discountTotal;
          const taxAmount = taxableAmount * (taxRate || 0);
          const total = taxableAmount + taxAmount;
          
          // Calculate deposit amount
          let calculatedDepositAmount = depositAmount || 0;
          if (depositType === 'percentage' && depositValue > 0) {
            calculatedDepositAmount = (total * depositValue) / 100;
          } else if (depositType === 'fixed' && depositValue > 0) {
            calculatedDepositAmount = depositValue;
          }
          
          updateData = {
            ...updateData,
            sections: sectionsWithTotals,
            subtotal,
            taxAmount,
            discountAmount: discountTotal,
            total,
            depositAmount: calculatedDepositAmount,
          };
          
          // Update payment summary with new totals
          if (existingQuote.paymentSummary) {
            updateData['paymentSummary.totalRequired'] = total;
            updateData['paymentSummary.depositRequired'] = calculatedDepositAmount;
            updateData['paymentSummary.balance'] = total - (existingQuote.paymentSummary.totalPaid || 0);
          }
        }
        
        // Update other fields if provided
        if (title !== undefined) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (taxRate !== undefined) updateData.taxRate = parseFloat(taxRate);
        if (discountPercentage !== undefined) updateData.discountPercentage = parseFloat(discountPercentage);
        if (termsAndConditions !== undefined) updateData.termsAndConditions = termsAndConditions;
        if (paymentTerms !== undefined) updateData.paymentTerms = paymentTerms;
        if (notes !== undefined) updateData.notes = notes;
        if (scopeOfWork !== undefined) updateData.scopeOfWork = scopeOfWork;
        
        // Update deposit fields
        if (depositType !== undefined) updateData.depositType = depositType;
        if (depositValue !== undefined) updateData.depositValue = parseFloat(depositValue);
        
        updateData.updatedAt = new Date().toISOString();
        
        const fieldsUpdated = Object.keys(updateData).filter(k => k !== 'updatedAt');
        activityEntry = {
          action: 'content_updated',
          timestamp: new Date().toISOString(),
          userId: userId || 'system',
          metadata: { fieldsUpdated }
        };
        
        log('Updating quote content:', { id, fieldsCount: fieldsUpdated.length });
        break;
        
      case 'create_revision':
        // This is now handled by the separate create-revision endpoint
        return res.status(400).json({ 
          error: 'Use /api/quotes/[id]/create-revision endpoint for creating revisions' 
        });
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Add activity entry if exists
    const updateQuery: any = { $set: updateData };
    if (activityEntry) {
      updateQuery.$push = { activityFeed: activityEntry };
    }
    
    const result = await db.collection('quotes').updateOne(
      { _id: new ObjectId(id), locationId },
      updateQuery
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    log('Quote updated successfully:', { id, action, matchedCount: result.matchedCount });
    
    // Fetch the updated quote to send in the event
    const updatedQuote = await db.collection('quotes').findOne({ _id: new ObjectId(id) });
    
    // Publish real-time event with minimal payload
    if (updatedQuote) {
      await ably.channels.get(`location:${locationId}`).publish('quote.updated', {
        quoteId: updatedQuote._id,
        quoteNumber: updatedQuote.quoteNumber,
        status: updatedQuote.status,
        total: updatedQuote.total,
        timestamp: new Date().toISOString()
      });
    }
    
        // Publish Ably event for quote update with minimal payload
    await publishAblyEvent({
      locationId: locationId,
      userId: userId || req.headers['x-user-id'] as string || 'system',
      entity: {
        _id: updatedQuote._id,
        quoteNumber: updatedQuote.quoteNumber,
        status: updatedQuote.status,
        total: updatedQuote.total,
        updatedAt: updatedQuote.updatedAt,
        // Don't include templateSnapshot or large objects
      },
      eventType: 'quote:updated'
    });

    // 🔄 Check for quote status changes and create automation triggers
    if (updateData.status && existingQuote.status !== updateData.status) {
      if (updateData.status === 'signed') {
        // Use the event listener for consistent data including deposit information
        try {
          const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
          const automationEventListener = new AutomationEventListener(db);
          await automationEventListener.emitQuoteSigned(existingQuote);
        } catch (error) {
          console.error('Failed to emit quote-signed:', error);
        }
      } else if (updateData.status === 'sent') {
        try {
          const { AutomationEventListener } = await import('../../../src/services/automationEventListener');
          const automationEventListener = new AutomationEventListener(db);
          await automationEventListener.emitQuoteSent(existingQuote);
        } catch (error) {
          console.error('Failed to emit quote-sent:', error);
        }
      }
    }

    // Publish additional Ably event for general quote updates
    const ablyInstance = getAblyInstance();
    await publishAblyEventFromHelper(ablyInstance, `location:${existingQuote.locationId}`, 'quote.updated', {
      quoteId: id,
      status: updateData.status || existingQuote.status,
      amount: updateData.total || existingQuote.total
    });

    // Update pipeline stage if status changed
    if (shouldUpdatePipelineStage && newStatus) {
      await updatePipelineStage(db, existingQuote, newStatus, userId);
    }

    // Fix 6: Update project stage when quote status changes
    if (shouldUpdatePipelineStage && newStatus && existingQuote.projectId) {
      try {
        let targetStageId = null;
        
        // Map quote status to pipeline stage
        switch (newStatus) {
          case 'published':
            targetStageId = 'd555045c-9857-4dba-8690-9631068b847e'; // Quote Sent stage
            break;
          case 'presented':
            targetStageId = 'd555045c-9857-4dba-8690-9631068b847e'; // Quote Sent stage
            break;
          case 'viewed':
            targetStageId = 'd555045c-9857-4dba-8690-9631068b847e'; // Quote Sent stage
            break;
          case 'accepted':
            targetStageId = 'accepted-stage-id'; // Replace with actual accepted stage ID
            break;
          case 'signed':
            targetStageId = 'signed-stage-id'; // Replace with actual signed stage ID
            break;
        }
        
        if (targetStageId) {
          await db.collection('projects').updateOne(
            { _id: new ObjectId(existingQuote.projectId) },
            { 
              $set: { 
                pipelineStageId: targetStageId,
                quoteStatus: newStatus,
                quoteUpdatedAt: new Date()
              },
              $push: {
                timeline: {
                  id: new ObjectId().toString(),
                  event: 'quote_status_changed',
                  description: `Quote status changed to ${newStatus}`,
                  timestamp: new Date().toISOString(),
                  metadata: { 
                    quoteId: existingQuote._id, 
                    status: newStatus,
                    previousStatus: existingQuote.status 
                  }
                }
              }
            }
          );
          log('✅ [Fix 6] Updated project stage for quote status:', { 
            projectId: existingQuote.projectId, 
            newStatus, 
            targetStageId 
          });

          // Fix 7: Broadcast stage change via Ably for real-time updates
          try {
            const channel = ably.channels.get(`location:${existingQuote.locationId}:project:updated`);
            
            await channel.publish('stage-changed', {
              projectId: existingQuote.projectId.toString(),
              oldStage: existingQuote.pipelineStageId,
              newStage: targetStageId,
              pipelineId: existingQuote.pipelineId,
              trigger: 'quote_status_change',
              quoteStatus: newStatus,
              timestamp: new Date()
            });
            log('✅ [Fix 7] Broadcasted stage change via Ably');
          } catch (ablyError: any) {
            log('❌ [Fix 7] Failed to broadcast via Ably:', ablyError.message);
          }
        }
      } catch (error: any) {
        log('❌ [Fix 6] Failed to update project stage:', error.message);
      }
    }
    
    // Update project if needed
    if (projectUpdate && existingQuote.projectId) {
      try {
        await db.collection('projects').updateOne(
          { _id: new ObjectId(existingQuote.projectId) },
          {
            $set: {
              ...projectUpdate,
              updatedAt: new Date()
            },
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: `quote_${action}`,
                description: activityEntry?.metadata?.newStatus 
                  ? `Quote status changed to ${activityEntry.metadata.newStatus}`
                  : 'Quote updated',
                timestamp: new Date().toISOString(),
                userId: userId || 'system',
                metadata: {
                  quoteId: id,
                  quoteNumber: existingQuote.quoteNumber,
                  ...activityEntry?.metadata
                }
              }
            }
          }
        );
        log('Updated project after quote update:', existingQuote.projectId);
      } catch (projectError: any) {
        log('Failed to update project:', projectError.message);
      }
    }
    
    // Return response based on action
    if (action === 'publish') {
      return res.status(200).json({
        success: true,
        message: 'Quote published successfully',
        webLink: {
          token: updateData.webLinkToken,
          expiry: updateData.webLinkExpiry,
        }
      });
    } else if (action === 'update_content') {
      // Check if quote was published and has significant changes
      const wasPublished = ['published', 'sent', 'viewed', 'presented'].includes(existingQuote.status);
      const hasSignificantChanges = changedFields.length > 0 || 
        (updateData.total && Math.abs(updateData.total - previousTotal) > 0.01);
      
      if (wasPublished && hasSignificantChanges) {
        return res.status(200).json({ 
          success: true,
          wasPublished: true,
          previousTotal,
          newTotal: updateData.total || existingQuote.total,
          changesSummary: changedFields.join('\n'),
          shouldNotifyCustomer: true
        });
      }
      
      return res.status(200).json({ success: true });
    } else {
      return res.status(200).json({ success: true });
    }
    
  } catch (error: any) {
    log('Error updating quote:', error.message);
    console.error('[QUOTE API] Error updating quote:', error);
    return res.status(500).json({ 
      error: 'Failed to update quote',
      details: error.message 
    });
  }
}

// Update pipeline stage based on quote status
async function updatePipelineStage(db: any, quote: any, newStatus: string, userId: string) {
  try {
    log('Checking for pipeline stage update:', { newStatus });

    // Get location settings to find target stage
    const location = await db.collection('locations').findOne({
      locationId: quote.locationId
    });

    if (!location?.pipelineSettings) {
      log('No pipeline settings found for location');
      return;
    }

    let targetStageId = null;

    // Map status to pipeline stage based on location settings
    switch (newStatus) {
      case 'presented':
        targetStageId = location.pipelineSettings.presentedStageId;
        break;
      case 'published':
        targetStageId = location.pipelineSettings.publishedStageId;
        break;
      case 'accepted':
        targetStageId = location.pipelineSettings.acceptedStageId;
        break;
      case 'signed':
        targetStageId = location.pipelineSettings.signedStageId;
        break;
    }

    if (!targetStageId) {
      log('No target stage configured for status:', newStatus);
      return;
    }

    // Update project stage if quote has a projectId
    if (quote.projectId) {
      log('Updating project stage:', { 
        projectId: quote.projectId, 
        targetStageId 
      });

      await db.collection('projects').updateOne(
        { _id: new ObjectId(quote.projectId) },
        { 
          $set: { 
            stageId: targetStageId,
            updatedAt: new Date(),
            updatedBy: userId,
          }
        }
      );

      log('Project stage updated successfully');
    }

  } catch (error: any) {
    log('Failed to update pipeline stage:', error.message);
    // Don't throw - this is a secondary operation
  }
}

// 🗑️ DELETE: Soft delete quote
async function deleteQuote(db: any, id: string, query: any, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { locationId, userId } = query;
    
    log('deleteQuote called:', { id, locationId, userId });
    
    if (!locationId) {
      return res.status(400).json({ error: 'Missing locationId' });
    }
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid quote ID format' });
    }
    
    // Get quote first to update project
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(id),
      locationId
    });
    
    if (!quote) {
      log('Quote not found for deletion:', id);
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    const result = await db.collection('quotes').updateOne(
      { _id: new ObjectId(id), locationId },
      { 
        $set: { 
          status: 'deleted',
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        $push: {
          activityFeed: {
            action: 'deleted',
            timestamp: new Date().toISOString(),
            userId: userId || 'system',
            metadata: {}
          }
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    
    // Publish Ably event for quote deletion
    await publishAblyEvent({
      locationId: locationId,
      userId: userId || req.headers['x-user-id'] as string || 'system',
      entity: { _id: id },
      eventType: 'quote:deleted'
    });
    
    // Update project if exists
    if (quote.projectId) {
      try {
        await db.collection('projects').updateOne(
          { _id: new ObjectId(quote.projectId) },
          {
            $unset: { 
              quoteId: "", 
              activeQuoteId: "" 
            },
            $set: {
              hasQuote: false,
              updatedAt: new Date()
            },
            $push: {
              timeline: {
                id: new ObjectId().toString(),
                event: 'quote_deleted',
                description: `Quote ${quote.quoteNumber} was deleted`,
                timestamp: new Date().toISOString(),
                userId: userId || 'system',
                metadata: {
                  quoteId: id,
                  quoteNumber: quote.quoteNumber
                }
              }
            }
          }
        );
        log('Updated project after quote deletion');
      } catch (projectError: any) {
        log('Failed to update project after deletion:', projectError.message);
      }
    }
    
    log('Soft deleted quote successfully:', id);
    return res.status(200).json({ success: true });
    
  } catch (error: any) {
    log('Error deleting quote:', error.message);
    console.error('[QUOTE API] Error deleting quote:', error);
    return res.status(500).json({ 
      error: 'Failed to delete quote',
      details: error.message 
    });
  }
}