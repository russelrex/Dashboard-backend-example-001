import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    // Check automation queue
    const queueItems = await db.collection('automation_queue')
      .find({})
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    // Check automation rules
    const rules = await db.collection('automation_rules')
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // Check recent projects
    const projects = await db.collection('projects')
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    // Check recent contacts
    const contacts = await db.collection('contacts')
      .find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      queue: {
        total: queueItems.length,
        items: queueItems.map(item => ({
          id: item._id,
          actionType: item.actionType,
          status: item.status,
          scheduledFor: item.scheduledFor,
          createdAt: item.createdAt,
          metadata: item.metadata
        }))
      },
      rules: {
        total: rules.length,
        items: rules.map(rule => ({
          id: rule._id,
          name: rule.name,
          trigger: rule.trigger,
          actions: rule.actions?.map((action: any) => ({
            type: action.type,
            config: action.config
          }))
        }))
      },
      projects: {
        total: projects.length,
        items: projects.map(project => ({
          id: project._id,
          title: project.title,
          status: project.status,
          assignedTo: project.assignedTo,
          createdAt: project.createdAt
        }))
      },
      contacts: {
        total: contacts.length,
        items: contacts.map(contact => ({
          id: contact._id,
          name: contact.name,
          firstName: contact.firstName,
          lastName: contact.lastName,
          assignedTo: contact.assignedTo,
          createdAt: contact.createdAt
        }))
      }
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    return res.status(500).json({ 
      error: 'Failed to check automation status',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
