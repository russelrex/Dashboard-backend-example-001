// pages/api/quotes/[id]/unpublish.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check - copied from your actual quotes/[id].ts file
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      jwt.verify(token, process.env.JWT_SECRET!);
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { id: quoteId } = req.query;
    const { locationId, userId } = req.body;

    if (!quoteId || !locationId || !userId) {
      return res.status(400).json({ 
        error: 'Missing required fields' 
      });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Find and update the quote
    const quote = await db.collection('quotes').findOne({
      _id: new ObjectId(quoteId as string),
      locationId,
      status: { $in: ['sent', 'published', 'viewed'] }
    });

    if (!quote) {
      return res.status(404).json({ 
        success: false,
        error: 'Quote not found or already unpublished' 
      });
    }

    // Update to unpublish
    await db.collection('quotes').updateOne(
      { _id: new ObjectId(quoteId as string) },
      {
        $set: {
          status: 'draft',
          publishedAt: null,
          publishedBy: null,
          webLinkToken: null,
          webLinkExpiry: null,
          sentAt: null,
          updatedAt: new Date()
        },
        $push: {
          activityFeed: {
            action: 'unpublished',
            timestamp: new Date(),
            userId,
            metadata: {
              previousStatus: quote.status
            }
          }
        }
      }
    );

    // Get updated quote
    const updatedQuote = await db.collection('quotes').findOne({
      _id: new ObjectId(quoteId as string)
    });

    return res.status(200).json({
      success: true,
      quote: updatedQuote
    });

  } catch (error) {
    console.error('Unpublish error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
}