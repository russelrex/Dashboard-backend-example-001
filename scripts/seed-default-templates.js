// scripts/seed-default-templates.js
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const defaultSMSTemplates = [
  {
    name: 'Job Scheduled Confirmation',
    content: 'Hi ${contact.firstName}, your ${project.title} has been scheduled for ${appointment.date} at ${appointment.time}. We\'ll see you then! Reply STOP to opt out.',
    category: 'appointments',
    variables: ['contact.firstName', 'project.title', 'appointment.date', 'appointment.time']
  },
  {
    name: 'Quote Follow-up',
    content: 'Hi ${contact.firstName}, just following up on the quote for ${project.title}. Do you have any questions? Reply YES if you\'d like to proceed or call ${location.phone}.',
    category: 'quotes',
    variables: ['contact.firstName', 'project.title', 'location.phone']
  },
  {
    name: 'Payment Received',
    content: 'Thank you ${contact.firstName}! We received your payment of $${payment.amount} for ${project.title}. Your receipt: ${payment.receiptUrl}',
    category: 'payments',
    variables: ['contact.firstName', 'payment.amount', 'project.title', 'payment.receiptUrl']
  },
  {
    name: 'Job Started',
    content: 'Hi ${contact.firstName}, our team has arrived and started work on ${project.title}. Estimated completion: ${project.estimatedCompletion}.',
    category: 'projects',
    variables: ['contact.firstName', 'project.title', 'project.estimatedCompletion']
  },
  {
    name: 'Quality Check Complete',
    content: 'Hi ${contact.firstName}, quality check is complete for ${project.title}. Everything looks great! We\'ll be in touch to schedule final walkthrough.',
    category: 'projects',
    variables: ['contact.firstName', 'project.title']
  }
];

const defaultEmailTemplates = [
  {
    name: 'Quote Sent',
    subject: 'Your Quote for ${project.title} is Ready',
    content: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f8f9fa; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .button { 
      display: inline-block; 
      padding: 12px 30px; 
      background-color: #007bff; 
      color: white; 
      text-decoration: none; 
      border-radius: 5px; 
      margin: 20px 0;
    }
    .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>\${location.name}</h1>
    </div>
    <div class="content">
      <h2>Hi \${contact.firstName},</h2>
      <p>Thank you for your interest in our services. Your quote for <strong>\${project.title}</strong> is ready for review.</p>
      <p><strong>Quote Total: $\${quote.total}</strong></p>
      <p style="text-align: center;">
        <a href="\${quote.viewUrl}" class="button">View Your Quote</a>
      </p>
      <p>This quote is valid for 30 days. Please let us know if you have any questions.</p>
      <p>Best regards,<br>\${location.name} Team</p>
    </div>
    <div class="footer">
      <p>\${location.address}<br>\${location.phone} | \${location.email}</p>
    </div>
  </div>
</body>
</html>`,
    category: 'quotes',
    variables: ['contact.firstName', 'project.title', 'quote.total', 'quote.viewUrl', 'location.name', 'location.address', 'location.phone', 'location.email']
  },
  {
    name: 'Appointment Reminder',
    subject: 'Reminder: ${appointment.title} on ${appointment.date}',
    content: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .appointment-box { 
      background-color: #f0f8ff; 
      border: 2px solid #007bff; 
      padding: 20px; 
      border-radius: 8px; 
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>Appointment Reminder</h2>
    <p>Hi \${contact.firstName},</p>
    <p>This is a friendly reminder about your upcoming appointment:</p>
    <div class="appointment-box">
      <h3>\${appointment.title}</h3>
      <p><strong>Date:</strong> \${appointment.date}<br>
      <strong>Time:</strong> \${appointment.time}<br>
      <strong>Location:</strong> \${appointment.location}</p>
    </div>
    <p>If you need to reschedule, please call us at \${location.phone}.</p>
    <p>Thank you,<br>\${location.name}</p>
  </div>
</body>
</html>`,
    category: 'appointments',
    variables: ['contact.firstName', 'appointment.title', 'appointment.date', 'appointment.time', 'appointment.location', 'location.phone', 'location.name']
  },
  {
    name: 'Project Completed',
    subject: '${project.title} - Project Completed',
    content: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .success-banner { background-color: #28a745; color: white; padding: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-banner">
      <h1>Project Completed! ✓</h1>
    </div>
    <p>Hi \${contact.firstName},</p>
    <p>Great news! We've completed work on <strong>\${project.title}</strong>.</p>
    <p>Your invoice will be sent separately. If you have any questions or concerns about the completed work, please don't hesitate to contact us.</p>
    <p>Thank you for choosing \${location.name}!</p>
    <p>Best regards,<br>\${user.name}<br>\${location.name}</p>
  </div>
</body>
</html>`,
    category: 'projects',
    variables: ['contact.firstName', 'project.title', 'location.name', 'user.name']
  }
];

async function seedTemplates() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    // Get all locations
    const locations = await db.collection('locations').find({}).toArray();
    console.log(`Found ${locations.length} locations`);
    
    for (const location of locations) {
      // Check if templates already exist
      const existingSmsCount = await db.collection('sms_templates')
        .countDocuments({ locationId: location._id.toString() });
      
      const existingEmailCount = await db.collection('email_templates')
        .countDocuments({ locationId: location._id.toString() });
      
      if (existingSmsCount === 0) {
        // Insert SMS templates
        const smsTemplates = defaultSMSTemplates.map(t => ({
          ...t,
          locationId: location._id.toString(),
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }));
        
        await db.collection('sms_templates').insertMany(smsTemplates);
        console.log(`✅ Added ${smsTemplates.length} SMS templates for ${location.name}`);
      } else {
        console.log(`⏭️  SMS templates already exist for ${location.name}`);
      }
      
      if (existingEmailCount === 0) {
        // Insert email templates
        const emailTemplates = defaultEmailTemplates.map(t => ({
          ...t,
          locationId: location._id.toString(),
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }));
        
        await db.collection('email_templates').insertMany(emailTemplates);
        console.log(`✅ Added ${emailTemplates.length} email templates for ${location.name}`);
      } else {
        console.log(`⏭️  Email templates already exist for ${location.name}`);
      }
    }
    
    console.log('✅ Template seeding completed!');
  } catch (error) {
    console.error('❌ Error seeding templates:', error);
  } finally {
    await client.close();
  }
}

seedTemplates();