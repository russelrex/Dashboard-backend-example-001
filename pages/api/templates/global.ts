// pages/api/templates/global.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '../../../src/lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const globalTemplates = await db.collection('templates')
      .find({ isGlobal: true })
      .toArray();
    
    res.status(200).json(globalTemplates);
  } catch (error) {
    console.error('Error fetching global templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
}