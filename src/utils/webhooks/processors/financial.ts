// src/utils/webhooks/processors/financial.ts
import { BaseProcessor } from './base';
import { QueueItem } from '../queueManager';
import { ObjectId, Db } from 'mongodb';
import Ably from 'ably';
import { shouldPublishRealtimeEvent } from '../../../utils/realtimeDedup';
import { oneSignalService } from '../../../services/oneSignalService';

// Initialize Ably
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

export class FinancialProcessor extends BaseProcessor {
  constructor(db?: Db) {
    super({
      queueType: 'financial',
      batchSize: 30,
      maxRuntime: 50000,
      processorName: 'FinancialProcessor'
    }, db);
  }

  /**
   * Process financial webhooks
   */
  protected async processItem(item: QueueItem): Promise<void> {
    const { type, payload, webhookId } = item;

    // Track financial processing start
    const financialStartTime = Date.now();

    switch (type) {
      // Invoice Events
      case 'InvoiceCreate':
        await this.processInvoiceCreate(payload, webhookId);
        break;
      case 'InvoiceUpdate':
        await this.processInvoiceUpdate(payload, webhookId);
        break;
      case 'InvoiceDelete':
        await this.processInvoiceDelete(payload, webhookId);
        break;
      case 'InvoiceVoid':
        await this.processInvoiceVoid(payload, webhookId);
        break;
      case 'InvoicePaid':
        await this.processInvoicePaid(payload, webhookId);
        break;
      case 'InvoicePartiallyPaid':
        await this.processInvoicePartiallyPaid(payload, webhookId);
        break;
        
      // Order Events
      case 'OrderCreate':
        await this.processOrderCreate(payload, webhookId);
        break;
      case 'OrderStatusUpdate':
        await this.processOrderStatusUpdate(payload, webhookId);
        break;
        
      // Product/Price Events
      case 'ProductCreate':
      case 'ProductUpdate':
      case 'ProductDelete':
        await this.processProductEvent(type, payload, webhookId);
        break;
      case 'PriceCreate':
      case 'PriceUpdate':
      case 'PriceDelete':
        await this.processPriceEvent(type, payload, webhookId);
        break;
        
      default:
        console.warn(`[FinancialProcessor] Unknown financial type: ${type}`);
        throw new Error(`Unsupported financial webhook type: ${type}`);
    }

    // Track financial processing time
    const processingTime = Date.now() - financialStartTime;
    if (processingTime > 2000) {
      console.warn(`[FinancialProcessor] Slow financial processing: ${processingTime}ms for ${type}`);
    }
  }

  /**
   * Process invoice create
   */
  private async processInvoiceCreate(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let invoiceData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      invoiceData = payload.webhookPayload;
      locationId = payload.locationId || invoiceData.locationId;
    } else {
      // Direct format
      invoiceData = payload;
      locationId = payload.locationId;
    }
    
    // Check if invoice is nested or if the payload itself IS the invoice
    const invoice = invoiceData.invoice || invoiceData;
    
    // GHL uses _id, not id - support both
    const invoiceId = invoice.id || invoice._id;
    
    if (!invoiceId || !locationId) {
      console.error(`[FinancialProcessor] Missing required invoice data:`, {
        invoiceId: invoiceId,
        locationId: !!locationId,
        webhookId,
        payloadKeys: Object.keys(invoice || {})
      });
      throw new Error('Missing required invoice data');
    }
    
    console.log(`[FinancialProcessor] Creating invoice ${invoiceId}`);
    
    // Start session for atomic operations
    const session = this.client.startSession();
    
    try {
      await session.withTransaction(async () => {
        await this.db.collection('invoices').updateOne(
          { ghlInvoiceId: invoiceId, locationId },
          {
            $set: {
              ghlInvoiceId: invoiceId,
              locationId,
              contactId: invoice.contactId,
              invoiceNumber: invoice.invoiceNumber || invoice.number,
              status: invoice.status || 'draft',
              amount: invoice.amount || invoice.total || 0,
              amountPaid: invoice.amountPaid || 0,
              amountDue: invoice.amountDue || invoice.amount || invoice.total || 0,
              currency: invoice.currency || 'USD',
              dueDate: invoice.dueDate ? new Date(invoice.dueDate) : null,
              issueDate: invoice.issueDate ? new Date(invoice.issueDate) : new Date(),
              items: invoice.items || invoice.lineItems || [],
              taxes: invoice.taxes || [],
              discounts: invoice.discounts || [],
              notes: invoice.notes || invoice.description || '',
              terms: invoice.terms || '',
              metadata: invoice.metadata || {},
              lastWebhookUpdate: new Date(),
              updatedAt: new Date(),
              processedBy: 'queue',
              webhookId
            },
            $setOnInsert: {
              _id: new ObjectId(),
              createdAt: new Date(),
              createdByWebhook: webhookId
            }
          },
          { upsert: true, session }
        );
        
        // Update related project if exists
        if (invoice.opportunityId) {
          await this.updateProjectFinancials(invoice.opportunityId, locationId, 'invoice_created', invoice, session);
        }
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Process invoice update
   */
  private async processInvoiceUpdate(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let invoiceData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      invoiceData = payload.webhookPayload;
      locationId = payload.locationId || invoiceData.locationId;
    } else {
      // Direct format
      invoiceData = payload;
      locationId = payload.locationId;
    }
    
    // Check if invoice is nested or if the payload itself IS the invoice
    const invoice = invoiceData.invoice || invoiceData;
    
    // GHL uses _id, not id - support both
    const invoiceId = invoice.id || invoice._id;
    
    if (!invoiceId || !locationId) {
      console.error(`[FinancialProcessor] Missing required invoice data:`, {
        invoiceId: invoiceId,
        locationId: !!locationId,
        webhookId,
        payloadKeys: Object.keys(invoice || {})
      });
      throw new Error('Missing required invoice data');
    }
    
    console.log(`[FinancialProcessor] Updating invoice ${invoiceId}`);
    
    const updateData: any = {
      lastWebhookUpdate: new Date(),
      updatedAt: new Date(),
      processedBy: 'queue',
      webhookId
    };
    
    // Update fields that might change
    const fieldsToUpdate = [
      'status', 'currency', 'notes', 'terms', 'metadata'
    ];
    
    fieldsToUpdate.forEach(field => {
      if (invoice[field] !== undefined) {
        updateData[field] = invoice[field];
      }
    });
    
    // Handle amount fields
    if (invoice.amount !== undefined) updateData.amount = invoice.amount;
    if (invoice.total !== undefined && invoice.amount === undefined) updateData.amount = invoice.total;
    if (invoice.amountPaid !== undefined) updateData.amountPaid = invoice.amountPaid;
    if (invoice.amountDue !== undefined) updateData.amountDue = invoice.amountDue;
    
    // Handle array fields
    if (invoice.items !== undefined) updateData.items = invoice.items;
    if (invoice.lineItems !== undefined && invoice.items === undefined) updateData.items = invoice.lineItems;
    if (invoice.taxes !== undefined) updateData.taxes = invoice.taxes;
    if (invoice.discounts !== undefined) updateData.discounts = invoice.discounts;
    
    // Handle date fields
    if (invoice.dueDate) updateData.dueDate = new Date(invoice.dueDate);
    if (invoice.issueDate) updateData.issueDate = new Date(invoice.issueDate);
    
    const result = await this.db.collection('invoices').updateOne(
      { ghlInvoiceId: invoiceId, locationId },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      console.log(`[FinancialProcessor] Invoice not found, creating new one`);
      await this.processInvoiceCreate(payload, webhookId);
    }
  }

  /**
   * Process invoice delete
   */
  private async processInvoiceDelete(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let invoiceData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      invoiceData = payload.webhookPayload;
      locationId = payload.locationId || invoiceData.locationId;
    } else {
      // Direct format
      invoiceData = payload;
      locationId = payload.locationId;
    }
    
    // Check if invoice is nested or if the payload itself IS the invoice
    const invoice = invoiceData.invoice || invoiceData;
    
    // GHL uses _id, not id - support both
    const invoiceId = invoice.id || invoice._id;
    
    console.log(`[FinancialProcessor] Deleting invoice ${invoiceId}`);
    
    if (!invoiceId || !locationId) {
      console.warn(`[FinancialProcessor] Missing invoice data for delete`);
      return;
    }
    
    await this.db.collection('invoices').updateOne(
      { ghlInvoiceId: invoiceId, locationId },
      { 
        $set: { 
          deleted: true,
          deletedAt: new Date(),
          deletedByWebhook: webhookId,
          status: 'deleted',
          processedBy: 'queue'
        } 
      }
    );
  }

  /**
   * Process invoice void
   */
  private async processInvoiceVoid(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let invoiceData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      invoiceData = payload.webhookPayload;
      locationId = payload.locationId || invoiceData.locationId;
    } else {
      // Direct format
      invoiceData = payload;
      locationId = payload.locationId;
    }
    
    // Check if invoice is nested or if the payload itself IS the invoice
    const invoice = invoiceData.invoice || invoiceData;
    
    // GHL uses _id, not id - support both
    const invoiceId = invoice.id || invoice._id;
    
    console.log(`[FinancialProcessor] Voiding invoice ${invoiceId}`);
    
    if (!invoiceId || !locationId) {
      console.warn(`[FinancialProcessor] Missing invoice data for void`);
      return;
    }
    
    await this.db.collection('invoices').updateOne(
      { ghlInvoiceId: invoiceId, locationId },
      { 
        $set: { 
          status: 'void',
          voidedAt: new Date(),
          voidedByWebhook: webhookId,
          lastWebhookUpdate: new Date(),
          processedBy: 'queue'
        } 
      }
    );
  }

  /**
   * Process invoice paid
   */
  private async processInvoicePaid(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let invoiceData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      invoiceData = payload.webhookPayload;
      locationId = payload.locationId || invoiceData.locationId;
    } else {
      // Direct format
      invoiceData = payload;
      locationId = payload.locationId;
    }
    
    // Check if invoice is nested or if the payload itself IS the invoice
    const invoice = invoiceData.invoice || invoiceData;
    
    // GHL uses _id, not id - support both
    const invoiceId = invoice.id || invoice._id;
    
    console.log(`[FinancialProcessor] Marking invoice ${invoiceId} as paid`);
    
    if (!invoiceId || !locationId) {
      console.warn(`[FinancialProcessor] Missing invoice data for paid status`);
      return;
    }
    
    const session = this.client.startSession();
    
    try {
      await session.withTransaction(async () => {
        await this.db.collection('invoices').updateOne(
          { ghlInvoiceId: invoiceId, locationId },
          { 
            $set: { 
              status: 'paid',
              paidAt: new Date(),
              amountPaid: invoice.amount || invoice.total || invoice.amountPaid,
              amountDue: 0,
              paymentDetails: invoice.paymentDetails || {},
              lastWebhookUpdate: new Date(),
              processedBy: 'queue',
              webhookId
            } 
          },
          { session }
        );
        
        // Update project financials
        if (invoice.opportunityId) {
          await this.updateProjectFinancials(invoice.opportunityId, locationId, 'invoice_paid', invoice, session);
        }
      });
    } finally {
      await session.endSession();
    }

    // Send notifications OUTSIDE the transaction
    try {
      // Get the updated invoice data for notifications
      const updatedInvoice = await this.db.collection('invoices').findOne(
        { ghlInvoiceId: invoiceId, locationId },
        { projection: { _id: 1, projectId: 1, contactName: 1, total: 1, amountPaid: 1 } }
      );

      if (updatedInvoice) {
        // If associated with a project, notify project followers
        if (updatedInvoice.projectId) {
          await ably.channels.get(`project:${updatedInvoice.projectId}`).publish('invoice:paid', {
            invoice: updatedInvoice,
            timestamp: new Date().toISOString()
          });
          
          // Send push notification to project assignee
          const project = await this.db.collection('projects').findOne(
            { _id: new ObjectId(updatedInvoice.projectId) },
            { projection: { assignedTo: 1, title: 1 } }
          );
          
          if (project?.assignedTo) {
            await oneSignalService.sendPaymentNotification(
              project.assignedTo,
              {
                ...updatedInvoice,
                amount: invoice.amountPaid || invoice.total,
                customerName: updatedInvoice.contactName || 'Customer'
              }
            );
            console.log('✅ [OneSignal] Sent payment notification to:', project.assignedTo);
          }
        }

        // Also broadcast to location for financial updates
        const locationChannel = ably.channels.get(`location:${locationId}`);
        await locationChannel.publish('invoices.changed', {
          action: 'paid',
          invoiceId: updatedInvoice._id.toString(),
          timestamp: new Date().toISOString()
        });
        console.log('[Ably] Broadcast invoice paid to location:', locationId);
      }

      // ✅ TRIGGER AUTOMATION FOR DEPOSIT PAYMENTS
      if (updatedInvoice?.projectId) {
        try {
          // Check if this is a deposit payment by looking at the invoice metadata
          const isDeposit = invoice.metadata?.paymentType === 'deposit' || 
                           invoice.description?.toLowerCase().includes('deposit') ||
                           invoice.opportunityId; // Assume deposit if associated with opportunity
          
          if (isDeposit) {
            // Get full project and contact data for automation context
            const project = updatedInvoice.projectId ? 
              await this.db.collection('projects').findOne({ _id: new ObjectId(updatedInvoice.projectId) }) : null;
            const contact = updatedInvoice.contactId ? 
              await this.db.collection('contacts').findOne({ _id: new ObjectId(updatedInvoice.contactId) }) : null;

            await this.db.collection('automation_queue').insertOne({
              trigger: {
                type: 'payment-received',
                entityType: 'payment',
                locationId: locationId,
                data: {
                  paymentId: updatedInvoice._id.toString(),
                  projectId: updatedInvoice.projectId,
                  quoteId: updatedInvoice.quoteId,
                  contactId: updatedInvoice.contactId,
                  amount: invoice.amountPaid || invoice.total,
                  paymentType: isDeposit ? 'deposit' : 'payment',
                  ghlInvoiceId: invoiceId,
                  payment: {
                    type: isDeposit ? 'deposit' : 'payment',
                    amount: invoice.amountPaid || invoice.total,
                    method: 'online'
                  },
                  project,
                  contact,
                  locationId: locationId
                }
              },
              status: 'pending',
              createdAt: new Date(),
              attempts: 0
            });
            
            console.log(`[FinancialProcessor] Queued automation trigger for deposit payment on project ${updatedInvoice.projectId}`);
          }
        } catch (automationError) {
          console.error('[FinancialProcessor] Failed to queue automation:', automationError);
          // Don't fail the webhook processing if automation fails
        }
      }

    } catch (notificationError) {
      console.error('❌ [Notification] Failed to send invoice notifications:', notificationError);
      // Don't throw - notifications shouldn't break the flow
    }
  }

  /**
   * Process invoice partially paid
   */
  private async processInvoicePartiallyPaid(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let invoiceData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      invoiceData = payload.webhookPayload;
      locationId = payload.locationId || invoiceData.locationId;
    } else {
      // Direct format
      invoiceData = payload;
      locationId = payload.locationId;
    }
    
    // Check if invoice is nested or if the payload itself IS the invoice
    const invoice = invoiceData.invoice || invoiceData;
    
    // GHL uses _id, not id - support both
    const invoiceId = invoice.id || invoice._id;
    
    console.log(`[FinancialProcessor] Recording partial payment for invoice ${invoiceId}`);
    
    if (!invoiceId || !locationId) {
      console.warn(`[FinancialProcessor] Missing invoice data for partial payment`);
      return;
    }
    
    await this.db.collection('invoices').updateOne(
      { ghlInvoiceId: invoiceId, locationId },
      { 
        $set: { 
          status: 'partially_paid',
          amountPaid: invoice.amountPaid || 0,
          amountDue: invoice.amountDue || (invoice.amount - (invoice.amountPaid || 0)),
          lastPaymentDate: new Date(),
          lastWebhookUpdate: new Date(),
          processedBy: 'queue',
          webhookId
        },
        $push: {
          payments: {
            amount: invoice.lastPaymentAmount || 0,
            date: new Date(),
            method: invoice.paymentMethod || 'unknown',
            reference: invoice.paymentReference || '',
            webhookId: webhookId
          }
        }
      }
    );
  }

  /**
   * Process order create
   */
  private async processOrderCreate(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let orderData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      orderData = payload.webhookPayload;
      locationId = payload.locationId || orderData.locationId;
    } else {
      // Direct format
      orderData = payload;
      locationId = payload.locationId;
    }
    
    const { order } = orderData;
    
    if (!order?.id || !locationId) {
      console.error(`[FinancialProcessor] Missing required order data:`, {
        orderId: order?.id,
        locationId: !!locationId,
        webhookId
      });
      throw new Error('Missing required order data');
    }
    
    console.log(`[FinancialProcessor] Creating order ${order.id}`);
    
    await this.db.collection('orders').updateOne(
      { ghlOrderId: order.id, locationId },
      {
        $set: {
          ghlOrderId: order.id,
          locationId,
          contactId: order.contactId,
          orderNumber: order.orderNumber || order.number,
          status: order.status || 'pending',
          amount: order.amount || order.total || 0,
          currency: order.currency || 'USD',
          items: order.items || order.lineItems || [],
          shippingAddress: order.shippingAddress || {},
          billingAddress: order.billingAddress || {},
          paymentStatus: order.paymentStatus || 'pending',
          fulfillmentStatus: order.fulfillmentStatus || 'unfulfilled',
          notes: order.notes || '',
          metadata: order.metadata || {},
          lastWebhookUpdate: new Date(),
          updatedAt: new Date(),
          processedBy: 'queue',
          webhookId
        },
        $setOnInsert: {
          _id: new ObjectId(),
          createdAt: new Date(),
          createdByWebhook: webhookId
        }
      },
      { upsert: true }
    );
  }

  /**
   * Process order status update
   */
  private async processOrderStatusUpdate(payload: any, webhookId: string): Promise<void> {
    // Handle nested structure
    let orderData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      orderData = payload.webhookPayload;
      locationId = payload.locationId || orderData.locationId;
    } else {
      // Direct format
      orderData = payload;
      locationId = payload.locationId;
    }
    
    const { order } = orderData;
    
    console.log(`[FinancialProcessor] Updating order ${order?.id} status to ${order?.status}`);
    
    if (!order?.id || !locationId) {
      console.warn(`[FinancialProcessor] Missing order data for status update`);
      return;
    }
    
    await this.db.collection('orders').updateOne(
      { ghlOrderId: order.id, locationId },
      { 
        $set: { 
          status: order.status,
          paymentStatus: order.paymentStatus || undefined,
          fulfillmentStatus: order.fulfillmentStatus || undefined,
          statusUpdatedAt: new Date(),
          lastWebhookUpdate: new Date(),
          processedBy: 'queue',
          webhookId
        } 
      }
    );
  }

  /**
   * Process product event
   */
  private async processProductEvent(type: string, payload: any, webhookId: string): Promise<void> {
    console.log(`[FinancialProcessor] Processing ${type}`);
    
    // Handle nested structure
    let productData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      productData = payload.webhookPayload;
      locationId = payload.locationId || productData.locationId;
    } else {
      // Direct format
      productData = payload;
      locationId = payload.locationId;
    }
    
    // Store product events for future use
    await this.db.collection('product_events').insertOne({
      _id: new ObjectId(),
      type,
      payload: productData,
      locationId,
      webhookId,
      processedAt: new Date(),
      processedBy: 'queue'
    });
  }

  /**
   * Process price event
   */
  private async processPriceEvent(type: string, payload: any, webhookId: string): Promise<void> {
    console.log(`[FinancialProcessor] Processing ${type}`);
    
    // Handle nested structure
    let priceData;
    let locationId;
    
    if (payload.webhookPayload) {
      // Native webhook format
      priceData = payload.webhookPayload;
      locationId = payload.locationId || priceData.locationId;
    } else {
      // Direct format
      priceData = payload;
      locationId = payload.locationId;
    }
    
    // Store price events for future use
    await this.db.collection('price_events').insertOne({
      _id: new ObjectId(),
      type,
      payload: priceData,
      locationId,
      webhookId,
      processedAt: new Date(),
      processedBy: 'queue'
    });
  }

  /**
   * Update project financials
   */
  private async updateProjectFinancials(
    opportunityId: string, 
    locationId: string, 
    event: string, 
    data: any,
    session?: any
  ): Promise<void> {
    const project = await this.db.collection('projects').findOne(
      {
        ghlOpportunityId: opportunityId,
        locationId
      },
      { projection: { _id: 1 }, session }
    );
    
    if (project) {
      await this.db.collection('projects').updateOne(
        { _id: project._id },
        {
          $push: {
            timeline: {
              id: new ObjectId().toString(),
              event: event,
              description: `Invoice ${data.invoiceNumber || data.number || data.id} - ${event.replace('_', ' ')}`,
              timestamp: new Date().toISOString(),
              metadata: {
                invoiceId: data.id,
                amount: data.amount || data.total,
                status: data.status
              }
            }
          },
          $set: {
            lastFinancialUpdate: new Date()
          }
        },
        { session }
      );
    }
  }
}