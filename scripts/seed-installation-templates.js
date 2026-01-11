/**
 * File: seed-installation-templates.js
 * Purpose: Seeds database with installation templates from your existing data
 * Author: LPai Team
 * Last Modified: 2025-09-11
 * Dependencies: MongoDB connection
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');

const INSTALLATION_TEMPLATES = {
  // Email Templates (from your email_templates.json)
  emailTemplates: [
    {
      name: "Estimate Sent",
      subject: "Your Estimate for {{project.title}} is Ready",
      content: "Hi {{contact.firstName}}, Thank you for your interest. Your estimate for {{project.title}} is ready. Estimate Total: ${{quote.total}}. View at: {{quote.viewUrl}}. Valid for 30 days. Best regards, {{location.name}} Team",
      category: "quotes",
      variables: ["contact.firstName", "project.title", "quote.total", "quote.viewUrl", "location.name"],
      isTemplate: true,
      locationId: "global"
    },
    {
      name: "Appointment Reminder", 
      subject: "Reminder: {{appointment.title}} on {{appointment.date}}",
      content: "Hi {{contact.firstName}}, This is a reminder about your appointment: {{appointment.title}} on {{appointment.date}} at {{appointment.time}}. Location: {{appointment.location}}. To reschedule call {{location.phone}}. Thank you, {{location.name}}",
      category: "appointments",
      variables: ["contact.firstName", "appointment.title", "appointment.date", "appointment.time", "appointment.location", "location.phone", "location.name"],
      isTemplate: true,
      locationId: "global"
    },
    {
      name: "Project Completed",
      subject: "{{project.title}} - Project Completed", 
      content: "Hi {{contact.firstName}}, Great news! We've completed work on {{project.title}}. Your invoice will be sent separately. Thank you for choosing {{location.name}}! Best regards, {{user.name}}",
      category: "projects",
      variables: ["contact.firstName", "project.title", "location.name", "user.name"],
      isTemplate: true,
      locationId: "global"
    }
  ],

  // Automation Rules (from your automation_rules.json)
  automationRules: [
    {
      name: "New Lead Introduction",
      description: "Immediate personalized introduction when new lead created",
      isActive: true,
      priority: 10,
      isTemplate: true,
      locationId: "global",
      trigger: {
        type: "project-created",
        entityType: "project"
      },
      conditions: [],
      actions: [
        {
          type: "send-sms",
          config: {
            recipient: "contact",
            message: "Hi {{contact.firstName}}, this is {{user.firstName}} from {{location.name}}.\n\nI look forward to working with you on your {{project.name}} project. Feel free to call or text me with any questions!"
          }
        },
        {
          type: "push-notification",
          config: {
            recipientType: "assigned-user",
            template: {
              title: "🔥 New Lead: {{contact.firstName}} {{contact.lastName}}",
              body: "{{project.name}} project - Call within 2 hours",
              priority: 10
            }
          }
        }
      ]
    },
    {
      name: "Appointment Confirmation - Immediate",
      description: "Sends confirmation immediately when appointment is scheduled",
      isActive: true,
      priority: 10,
      isTemplate: true,
      locationId: "global",
      trigger: {
        type: "appointment-scheduled",
        entityType: "appointment"
      },
      conditions: [],
      actions: [
        {
          type: "send-sms",
          config: {
            recipient: "contact",
            message: "Hi {{contact.firstName}}, this is {{user.firstName}} - Your {{project.name}} estimate is confirmed for {{appointment.date}} at {{appointment.time}}. I'll text you when I'm on the way. Feel free to text me here with any questions!"
          }
        }
      ]
    }
  ],

  // Default Pipelines (from your pipeline data)
  pipelines: [
    {
      name: "Estimates",
      ghlPipelineId: "template_estimates",
      isTemplate: true,
      locationId: "global",
      stages: [
        { name: "Created", position: 0, color: "#007bff" },
        { name: "Visit Scheduled", position: 1, color: "#007bff" },
        { name: "Visit Done", position: 2, color: "#007bff" },
        { name: "Quoting", position: 3, color: "#007bff" },
        { name: "Estimate Sent", position: 4, color: "#007bff" },
        { name: "Viewed", position: 5, color: "#007bff" },
        { name: "Accepted", position: 6, color: "#007bff" },
        { name: "Signed", position: 7, color: "#007bff" },
        { name: "Deposit", position: 8, color: "#007bff" }
      ]
    },
    {
      name: "Active Jobs", 
      ghlPipelineId: "template_active_jobs",
      isTemplate: true,
      locationId: "global",
      stages: [
        { name: "Pending Scheduling", position: 0, color: "#007bff" },
        { name: "Scheduled", position: 1, color: "#007bff" },
        { name: "In Progress", position: 2, color: "#007bff" },
        { name: "Quality Review", position: 3, color: "#007bff" },
        { name: "Customer Review", position: 4, color: "#007bff" },
        { name: "Final Adjustments", position: 5, color: "#007bff" },
        { name: "Completed", position: 6, color: "#007bff" },
        { name: "Invoiced", position: 7, color: "#007bff" },
        { name: "Paid", position: 8, color: "#007bff" }
      ]
    }
  ],

  // Default Calendars (from your calendar data)  
  calendars: [
    {
      name: "Quote Calendar",
      description: "For scheduling estimates and quotes",
      slotDuration: 30,
      slotInterval: 30,
      isTemplate: true,
      locationId: "global"
    },
    {
      name: "Field Work",
      description: "For scheduling active job work",
      slotDuration: 90,
      slotInterval: 30,
      isTemplate: true,
      locationId: "global"
    }
  ]
};

async function seedInstallationTemplates() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    const db = client.db();
    
    console.log('🌱 Seeding installation templates...');

    // Seed email templates
    for (const template of INSTALLATION_TEMPLATES.emailTemplates) {
      await db.collection('email_templates').updateOne(
        { name: template.name, locationId: 'global' },
        { $set: { ...template, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      );
    }
    console.log(`✅ Seeded ${INSTALLATION_TEMPLATES.emailTemplates.length} email templates`);

    // Seed automation rules
    for (const automation of INSTALLATION_TEMPLATES.automationRules) {
      await db.collection('automations').updateOne(
        { name: automation.name, locationId: 'global' },
        { $set: { ...automation, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      );
    }
    console.log(`✅ Seeded ${INSTALLATION_TEMPLATES.automationRules.length} automation rules`);

    // Seed pipeline templates
    for (const pipeline of INSTALLATION_TEMPLATES.pipelines) {
      await db.collection('pipelines').updateOne(
        { name: pipeline.name, locationId: 'global' },
        { $set: { ...pipeline, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      );
    }
    console.log(`✅ Seeded ${INSTALLATION_TEMPLATES.pipelines.length} pipeline templates`);

    // Seed calendar templates
    for (const calendar of INSTALLATION_TEMPLATES.calendars) {
      await db.collection('calendars').updateOne(
        { name: calendar.name, locationId: 'global' },
        { $set: { ...calendar, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      );
    }
    console.log(`✅ Seeded ${INSTALLATION_TEMPLATES.calendars.length} calendar templates`);

    console.log('🎉 Installation templates seeded successfully!');

  } catch (error) {
    console.error('❌ Error seeding templates:', error);
  } finally {
    await client.close();
  }
}

// Run if called directly
if (require.main === module) {
  seedInstallationTemplates();
}

module.exports = { seedInstallationTemplates, INSTALLATION_TEMPLATES };