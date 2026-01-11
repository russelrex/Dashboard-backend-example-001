// scripts/add-quote-update-template.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

async function addQuoteUpdateTemplate() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db('lpai');
    
    // Add quote update email template
    const template = {
      _id: 'quote_updated_notification',
      name: 'Quote Updated Notification',
      subject: 'Your Quote Has Been Updated - {{quoteNumber}}',
      type: 'email',
      category: 'quotes',
      variables: [
        'customerName',
        'quoteNumber', 
        'quoteTitle',
        'totalAmount',
        'previousAmount',
        'changesSummary',
        'webLink',
        'companyName',
        'senderName'
      ],
      htmlTemplate: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f8f9fa; padding: 20px; text-align: center;">
    <h1 style="color: #333; margin: 0;">{{companyName}}</h1>
    <p style="color: #666; margin: 5px 0;">Quote Update Notification</p>
  </div>
  
  <div style="padding: 20px; background-color: white;">
    <h2 style="color: #333;">Hi {{customerName}},</h2>
    
    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; color: #856404;">
        <strong>Your quote has been updated!</strong><br>
        Quote {{quoteNumber}} - {{quoteTitle}} has been revised based on our recent discussions.
      </p>
    </div>
    
    {{#if changesSummary}}
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #333;">What Changed:</h3>
      <p style="white-space: pre-line;">{{changesSummary}}</p>
    </div>
    {{/if}}
    
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #333;">Updated Quote Summary</h3>
      {{#if previousAmount}}
      <p><strong>Previous Total:</strong> <span style="text-decoration: line-through; color: #999;">${{previousAmount}}</span></p>
      {{/if}}
      <p><strong>New Total:</strong> <span style="font-size: 20px; color: #28a745;">${{totalAmount}}</span></p>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{webLink}}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
        View Updated Quote
      </a>
    </div>
    
    <p style="color: #666; font-size: 14px; text-align: center;">
      Please review the updated quote. All previous links will show the latest version.
    </p>
    
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 14px;">
        Best regards,<br>
        <strong>{{senderName}}</strong><br>
        {{companyName}}
      </p>
    </div>
  </div>
</div>
      `,
      smsTemplate: `Hi {{customerName}}, your quote {{quoteNumber}} has been updated. New total: ${{totalAmount}}. View changes: {{webLink}}`,
      isActive: true,
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('email_templates').updateOne(
      { _id: template._id },
      { $set: template },
      { upsert: true }
    );
    
    console.log('✅ Quote update template added successfully');
    
  } catch (error) {
    console.error('❌ Failed to add template:', error);
  } finally {
    await client.close();
  }
}

addQuoteUpdateTemplate();