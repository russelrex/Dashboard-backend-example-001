import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '../../../src/lib/cors';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { locationId, contactId, sentBy, limit = '50', offset = '0' } = req.query;

  if (!locationId || !contactId) {
    return res.status(400).json({ error: 'Missing required parameters: locationId and contactId' });
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET!);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({ error: 'Invalid limit. Must be between 1 and 100' });
    }

    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({ error: 'Invalid offset. Must be >= 0' });
    }

    const contactObjectId = ObjectId.isValid(contactId as string) 
      ? new ObjectId(contactId as string) 
      : null;

    const query: any = {
      locationId,
      $or: contactObjectId 
        ? [{ contactObjectId }, { contactId: contactObjectId }]
        : [{ ghlContactId: contactId as string }]
    };

    if (sentBy) {
      query.sentBy = sentBy as string;
    }

    const messages = await db.collection('sms_logs')
      .find(query)
      .sort({ sentAt: -1, receivedAt: -1 })
      .skip(offsetNum)
      .limit(limitNum)
      .toArray();

    const total = await db.collection('sms_logs').countDocuments(query);

    const transformedMessages = messages.map((msg: any) => ({
      _id: msg._id.toString(),
      message: msg.message || msg.body,
      fromNumber: msg.fromNumber,
      toNumber: msg.toNumber,
      direction: msg.direction || 'outbound',
      status: msg.status,
      templateKey: msg.templateKey,
      sentAt: msg.sentAt,
      receivedAt: msg.receivedAt,
      ghlMessageId: msg.ghlMessageId,
      ghlConversationId: msg.ghlConversationId,
      appointmentId: msg.appointmentId ? msg.appointmentId.toString() : null,
      projectId: msg.projectId ? msg.projectId.toString() : null,
      sentBy: msg.sentBy,
      createdAt: msg.sentAt || msg.receivedAt || msg.createdAt
    }));

    return res.status(200).json({
      success: true,
      messages: transformedMessages,
      pagination: {
        total,
        limit: limitNum,
        offset: offsetNum,
        hasMore: (offsetNum + limitNum) < total
      }
    });

  } catch (error: any) {
    console.error('[SMS Messages API] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch SMS messages',
      details: error.message 
    });
  }
}

