import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { appointmentId } = req.query;
  
  if (!appointmentId || typeof appointmentId !== 'string') {
    return res.status(400).json({ error: 'Appointment ID required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    
    const appointment = await db.collection('appointments').findOne({
      _id: new ObjectId(appointmentId)
    });
    
    if (!appointment) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    
    // Get related data
    const contact = await db.collection('contacts').findOne({ _id: new ObjectId(appointment.contactId) });
    const location = await db.collection('locations').findOne({ locationId: appointment.locationId });
    
    // Format dates for .ics
    const formatICSDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    };
    
    const startDate = new Date(appointment.start || appointment.startTime);
    const endDate = new Date(appointment.end || appointment.endTime || startDate.getTime() + 3600000);
    const now = new Date();
    
    // Generate .ics content
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LPai//Appointment//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
DTSTART:${formatICSDate(startDate)}
DTEND:${formatICSDate(endDate)}
DTSTAMP:${formatICSDate(now)}
UID:${appointment._id}@lpai.app
SUMMARY:${appointment.title || 'Appointment'}
DESCRIPTION:Appointment with ${location?.name || 'Company'}
LOCATION:${appointment.address || contact?.address || ''}
STATUS:CONFIRMED
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;

    // Return .ics file
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="appointment-${appointmentId}.ics"`);
    res.status(200).send(icsContent);
    
  } catch (error) {
    console.error('Error generating .ics file:', error);
    res.status(500).json({ error: 'Failed to generate calendar file' });
  }
}
