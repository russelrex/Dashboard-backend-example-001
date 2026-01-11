import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Find the tracking session
    const session = await db.collection('tracking_sessions').findOne({ token });

    if (!session) {
      return res.status(404).json({ error: 'Tracking session not found' });
    }

    if (session.status !== 'active') {
      return res.status(400).json({ 
        error: 'Session already ended',
        status: session.status 
      });
    }

    // Mark as manually arrived
    const now = new Date();
    await db.collection('tracking_sessions').updateOne(
      { token },
      {
        $set: {
          status: 'arrived',
          'arrivalDetection.manualArrival': true,
          'arrivalDetection.arrivedAt': now,
          lastUpdatedAt: now,
        },
      }
    );

    console.log('[Arrive] Customer manually marked arrived:', {
      token: token.substring(0, 10) + '...',
      sessionId: session._id,
      arrivedAt: now,
    });

    // ✅ TODO: Send notification to team that customer arrived
    // You can publish to Ably here:
    // await publishToAbly(`location:${session.locationId}`, 'customer_arrived', {
    //   appointmentId: session.appointmentId,
    //   customerId: session.customerId,
    //   arrivedAt: now,
    //   method: 'manual'
    // });

    return res.status(200).json({
      success: true,
      message: 'Arrival recorded',
      arrivedAt: now,
    });
  } catch (error) {
    console.error('[Arrive] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
