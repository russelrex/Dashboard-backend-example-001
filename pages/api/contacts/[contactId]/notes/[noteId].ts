import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../../src/lib/mongodb';
import cors from '../../../../../src/lib/cors';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { getAuthHeader } from '@/utils/ghlAuth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  const { contactId, noteId } = req.query;
  const { locationId } = req.body || req.query;

  if (!contactId || !noteId || !locationId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Standard JWT verification
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

    // Get location for GHL auth
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
    try {
      if (ObjectId.isValid(contactId as string) && String(new ObjectId(contactId as string)) === contactId) {
        contact = await db.collection('contacts').findOne({
          _id: new ObjectId(contactId as string),
          locationId
        });
      }
    } catch (e) {
      // Not a valid ObjectId
    }
    
    if (!contact) {
      contact = await db.collection('contacts').findOne({
        ghlContactId: contactId as string,
        locationId
      });
    }

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    // Use getAuthHeader
    const auth = await getAuthHeader(location);

    switch (req.method) {
      case 'PUT':
        const { text } = req.body;

        if (!text) {
          return res.status(400).json({ error: 'Note text is required' });
        }

        try {
          // Find the note in MongoDB first
        const existingNote = await db.collection('notes').findOne({
          $and: [
            {
              $or: [
                { _id: ObjectId.isValid(noteId as string) ? new ObjectId(noteId as string) : null },
                { ghlNoteId: noteId as string }
              ]
            },
            {
              $or: [
                { contactId: contact._id.toString() },  // Match MongoDB ID
                { contactId: contact.ghlContactId }      // Match GHL ID
              ]
            },
            { locationId }
          ]
        });

          if (!existingNote) {
            return res.status(404).json({ error: 'Note not found' });
          }

          // Update in GHL if note has GHL ID
          if (existingNote.ghlNoteId && contact.ghlContactId) {
            try {
              const ghlUserId = user?.ghlUserId || decoded.userId;
              const ghlUrl = `https://services.leadconnectorhq.com/contacts/${contact.ghlContactId}/notes/${existingNote.ghlNoteId}`;
              
              await axios.put(ghlUrl, {
                userId: ghlUserId,
                body: text
              }, {
                headers: {
                  'Authorization': auth.header,
                  'Version': '2021-07-28',
                  'Content-Type': 'application/json',
                  'Accept': 'application/json'
                }
              });
              
              console.log('[Notes API] Updated note in GHL:', existingNote.ghlNoteId);
            } catch (ghlError: any) {
              console.error('[Notes API] Error updating note in GHL:', ghlError.response?.data || ghlError);
              // Continue - we'll still update MongoDB
            }
          }

          // Update in MongoDB
          const updateResult = await db.collection('notes').updateOne(
            { _id: existingNote._id },
            { 
              $set: { 
                body: text,
                updatedAt: new Date(),
                updatedBy: user?.name || user?.email || 'Unknown User',
                updatedByUserId: user?._id?.toString() || decoded.userId
              }
            }
          );

          if (updateResult.modifiedCount === 0) {
            return res.status(400).json({ error: 'No changes made to note' });
          }

          // Fetch the updated note
          const updatedNote = await db.collection('notes').findOne({ _id: existingNote._id });

          return res.status(200).json({
            success: true,
            id: updatedNote._id.toString(),
            _id: updatedNote._id.toString(),
            body: updatedNote.body,
            updatedAt: updatedNote.updatedAt,
            updatedBy: updatedNote.updatedBy,
            ghlNoteId: updatedNote.ghlNoteId
          });
        } catch (error: any) {
          console.error('[Notes API] Error updating note:', error);
          return res.status(500).json({ 
            error: 'Failed to update note',
            details: error.message 
          });
        }
      
      case 'DELETE':
        try {
          // Find the note in MongoDB first
          const noteToDelete = await db.collection('notes').findOne({
            $or: [
              { _id: ObjectId.isValid(noteId as string) ? new ObjectId(noteId as string) : null },
              { ghlNoteId: noteId as string }
            ],
            locationId
          });

          if (!noteToDelete) {
            return res.status(404).json({ error: 'Note not found' });
          }

          // Delete from GHL if note has GHL ID
          if (noteToDelete.ghlNoteId && contact.ghlContactId) {
            try {
              const ghlUrl = `https://services.leadconnectorhq.com/contacts/${contact.ghlContactId}/notes/${noteToDelete.ghlNoteId}`;
              
              await axios.delete(ghlUrl, {
                headers: {
                  'Authorization': auth.header,
                  'Version': '2021-07-28',
                  'Accept': 'application/json'
                }
              });
              
              console.log('[Notes API] Deleted note from GHL:', noteToDelete.ghlNoteId);
            } catch (ghlError: any) {
              console.error('[Notes API] Error deleting note from GHL:', ghlError.response?.data || ghlError);
              // Continue - we'll still delete from MongoDB
            }
          }

          // Delete from MongoDB
          await db.collection('notes').deleteOne({ _id: noteToDelete._id });

          return res.status(200).json({
            success: true,
            message: 'Note deleted successfully'
          });
        } catch (error: any) {
          console.error('[Notes API] Error deleting note:', error);
          return res.status(500).json({ 
            error: 'Failed to delete note',
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