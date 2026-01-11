import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const now = new Date();
    const results = {
      contacts: 0,
      projects: 0,
      quotes: 0,
      notes: 0,
      appointments: 0
    };

    console.log('[Cleanup Cron] Starting permanent deletion of old soft-deleted records...');

    // Permanently delete contacts older than 30 days
    const contactsToDelete = await db.collection('contacts').find({
      permanentDeleteDate: { $lte: now }
    }).toArray();

    for (const contact of contactsToDelete) {
      // Delete the contact
      await db.collection('contacts').deleteOne({ _id: contact._id });
      results.contacts++;

      // Delete all related data
      const contactIdStr = contact._id.toString();

      // Projects
      const projectResult = await db.collection('projects').deleteMany({
        contactId: contactIdStr,
        deletedReason: 'contact_deleted'
      });
      results.projects += projectResult.deletedCount;

      // Quotes
      const quoteResult = await db.collection('quotes').deleteMany({
        contactId: contactIdStr,
        deletedReason: 'contact_deleted'
      });
      results.quotes += quoteResult.deletedCount;

      // Notes
      const noteResult = await db.collection('notes').deleteMany({
        contactId: contactIdStr,
        deletedReason: 'contact_deleted'
      });
      results.notes += noteResult.deletedCount;

      // Appointments
      const appointmentResult = await db.collection('appointments').deleteMany({
        contactId: contactIdStr,
        deletedReason: 'contact_deleted'
      });
      results.appointments += appointmentResult.deletedCount;
    }

    // Also clean up orphaned soft-deleted records
    // Projects without contacts
    const orphanedProjects = await db.collection('projects').deleteMany({
      permanentDeleteDate: { $lte: now },
      deletedReason: { $ne: 'contact_deleted' }
    });
    results.projects += orphanedProjects.deletedCount;

    // Quotes without contacts
    const orphanedQuotes = await db.collection('quotes').deleteMany({
      permanentDeleteDate: { $lte: now },
      deletedReason: { $ne: 'contact_deleted' }
    });
    results.quotes += orphanedQuotes.deletedCount;

    console.log('[Cleanup Cron] Permanent deletion complete:', results);

    return res.status(200).json({
      success: true,
      message: 'Cleanup completed successfully',
      deleted: results,
      timestamp: now
    });
  } catch (error) {
    console.error('[Cleanup Cron] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}