// pages/api/users/index.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { locationId } = req.query;

  if (!locationId || typeof locationId !== 'string') {
    return res.status(400).json({ error: 'Missing locationId' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    const users = await db
      .collection('users')
      .find({ locationId })
      .project({ hashedPassword: 0 }) // Don't send hashedPassword
      .toArray();
    return res.status(200).json(users);
  } catch (error) {
    console.error('❌ Failed to fetch users:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
