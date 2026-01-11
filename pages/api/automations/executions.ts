import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { locationId, status, limit = 50 } = req.query;

  if (!locationId) {
    return res.status(400).json({ error: 'Location ID required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db();

    const query: any = { locationId };
    if (status && status !== 'all') {
      query.status = status;
    }

    const executions = await db.collection('automation_executions')
      .find(query)
      .sort({ startedAt: -1 })
      .limit(parseInt(limit as string))
      .toArray();

    // Map executions to include automation names
    const automationIds = [...new Set(executions.map(e => e.automationId))];
    const automations = await db.collection('automations')
      .find({ _id: { $in: automationIds.map(id => new ObjectId(id)) } })
      .toArray();

    const automationMap = Object.fromEntries(
      automations.map(a => [a._id.toString(), a])
    );

    const executionsWithNames = executions.map(exec => ({
      ...exec,
      name: automationMap[exec.automationId]?.name || 'Unknown Automation',
    }));

    return res.status(200).json({ executions: executionsWithNames });
  } catch (error: any) {
    console.error('Error fetching automation executions:', error);
    return res.status(500).json({ error: 'Failed to fetch executions' });
  }
}
