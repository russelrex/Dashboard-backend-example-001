import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Location ID is required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Find SMS templates for this location (FIXED: use sms_templates not smsTemplates)
    const templatesDoc = await db.collection('sms_templates').findOne({
      locationId,
      isActive: true
    });

    if (templatesDoc && templatesDoc.templates) {
      return res.status(200).json({
        success: true,
        templates: templatesDoc.templates
      });
    }

    // Return default templates if none found
    const defaultTemplates = {
      'on-way': {
        message: "Hi {contactFirstName}, this is {userName} from {locationName}. I'm on my way and should arrive in approximately {eta} minutes. Thank you!",
        lastModified: new Date(),
        modifiedBy: 'system'
      },
      'running-late': {
        message: "Hi {contactFirstName}, I'm running about {lateMinutes} minutes behind. My new ETA is {newTime}. Sorry for the delay!",
        lastModified: new Date(),
        modifiedBy: 'system'
      },
      'arrived': {
        message: "Hi {contactFirstName}, I've arrived for our {appointmentTitle} appointment!",
        lastModified: new Date(),
        modifiedBy: 'system'
      },
      'appointment-reschedule': {
        message: "Hi {contactFirstName}, we need to reschedule your {appointmentTitle} appointment originally scheduled for {appointmentTime}. Please use this link to choose a new time: {rescheduleLink}",
        lastModified: new Date(),
        modifiedBy: 'system'
      }
    };

    return res.status(200).json({
      success: true,
      templates: defaultTemplates
    });
  } catch (error) {
    console.error('[SMS Templates API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch SMS templates',
      details: error.message 
    });
  }
}