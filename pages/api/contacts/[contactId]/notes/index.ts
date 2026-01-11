import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import cors from '../../../../../src/lib/cors';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { getAuthHeader } from '@/utils/ghlAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  const { contactId } = req.query;
  const { locationId } = req.method === 'GET' ? req.query : req.body;

  if (!contactId || !locationId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Standard JWT verification like your other files
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  let decoded: any;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Get location for GHL auth - matches your pattern
    const location = await db.collection('locations').findOne({ locationId });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Verify user has access to this location
    const user = await db.collection('users').findOne({
      ghlUserId: decoded.userId,
      locationId: locationId
    });

    if (!user) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get contact - handle both MongoDB ID and GHL ID
    let contact;
    let isMongoId = false;
    
    try {
      // Check if it's a valid MongoDB ObjectId
      if (ObjectId.isValid(contactId as string) && String(new ObjectId(contactId as string)) === contactId) {
        isMongoId = true;
        contact = await db.collection('contacts').findOne({
          _id: new ObjectId(contactId as string),
          locationId
        });
      }
    } catch (e) {
      // Not a valid ObjectId, treat as GHL ID
    }
    
    if (!contact) {
      // Try to find by GHL ID
      contact = await db.collection('contacts').findOne({
        ghlContactId: contactId as string,
        locationId
      });
    }

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Use getAuthHeader like your other files
    const auth = await getAuthHeader(location);

    switch (req.method) {
      case 'GET':
        try {
          // Build query
          const query: any = {
            locationId,
            $or: [
              { contactId: contact._id.toString() },
              { contactId: contact.ghlContactId },
              // Also check for notes that might have been created with just the MongoDB ID
              { contactId: contactId as string }
            ]
          };

          // ADDED: Filter by opportunityId if provided in query params
          const { opportunityId } = req.query;
          if (opportunityId) {
            query.opportunityId = opportunityId as string;
          }

          // Fetch notes from MongoDB - this is the source of truth
          const notes = await db.collection('notes')
            .find(query)
            .project({
              _id: 1,
              body: 1,
              contactId: 1,
              opportunityId: 1,
              createdAt: 1,
              updatedAt: 1,
              createdBy: 1,
              createdByUserId: 1,
              attachments: 1, // Add this line
              ghlNoteId: 1,
              source: 1
            })
            .sort({ createdAt: -1 })
            .toArray();

          // Transform notes to consistent format
          const transformedNotes = notes.map((note: any) => ({
            id: note.ghlNoteId || note._id.toString(),
            _id: note._id.toString(),
            body: note.body || note.text,
            attachments: note.attachments || [],  // ADDED: Include attachments in response
            createdBy: note.createdBy || note.createdByUserId || 'Unknown',
            createdByUserId: note.createdByUserId,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
            updatedBy: note.updatedBy,
            ghlNoteId: note.ghlNoteId,
            contactId: note.contactId,
            opportunityId: note.opportunityId || null  // ADDED: Include opportunityId in response
          }));

          return res.status(200).json(transformedNotes);
        } catch (error: any) {
          console.error('[Notes API] Error fetching notes:', error);
          return res.status(500).json({ 
            error: 'Failed to fetch notes',
            details: error.message 
          });
        }
      
      case 'POST':
        // ADDED: Extract opportunityId and attachments from request body
        const { text, userId: noteUserId, opportunityId, attachments } = req.body;

        if (!text) {
          return res.status(400).json({ error: 'Note text is required' });
        }

        try {
          let ghlNoteId = null;
          let ghlCreatedAt = new Date();
          
          // First, create note in GHL if contact has GHL ID
          if (contact.ghlContactId) {
            try {
              const ghlUrl = `https://services.leadconnectorhq.com/contacts/${contact.ghlContactId}/notes`;
              
              // ADDED: Include opportunityId in GHL request if provided
              const ghlPayload: any = {
                body: text
              };
              
              // Note: GHL API might not officially support opportunityId, but we'll try
              if (opportunityId) {
                ghlPayload.opportunityId = opportunityId;
              }
              
              const response = await axios.post(ghlUrl, ghlPayload, {
                headers: {
                  'Authorization': auth.header,
                  'Version': '2021-07-28',
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                }
              });

              const ghlNote = response.data.note || response.data;
              ghlNoteId = ghlNote.id;
              ghlCreatedAt = new Date(ghlNote.dateAdded || ghlNote.createdAt || new Date());
              
              console.log('[Notes API] Created note in GHL:', ghlNoteId);
            } catch (ghlError: any) {
              console.error('[Notes API] Error creating note in GHL:', ghlError.response?.data || ghlError);
              // Continue without GHL ID - we'll still save to MongoDB
            }
          }

          // Save to MongoDB with GHL note ID if available
          const noteData = {
            ghlNoteId: null,
            contactId,
            locationId,
            opportunityId: req.body.opportunityId,
            body: req.body.text.replace(/\n\n📷 Attachments: \d+ photos?/, '').trim(), // Clean text
            attachments: req.body.attachments || [], // Add attachments field
            createdBy: req.body.createdBy || user.name,
            createdByUserId: req.body.userId || user._id,
            createdAt: new Date(),
            source: 'mobile_app',
            ghlSyncStatus: 'pending'
          };

          const insertResult = await db.collection('notes').insertOne(noteData);

          return res.status(201).json({
            success: true,
            id: insertResult.insertedId.toString(),
            _id: insertResult.insertedId.toString(),
            body: text,
            attachments: noteData.attachments,  // ADDED: Return attachments in response
            createdBy: noteData.createdBy,
            createdByUserId: noteData.createdByUserId,
            createdAt: noteData.createdAt,
            ghlNoteId: ghlNoteId,
            contactId: noteData.contactId,
            opportunityId: noteData.opportunityId  // ADDED: Return opportunityId in response
          });
        } catch (error: any) {
          console.error('[Notes API] Error creating note:', error);
          return res.status(500).json({ 
            error: 'Failed to create note',
            details: error.message 
          });
        }
      
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('[Notes API] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}