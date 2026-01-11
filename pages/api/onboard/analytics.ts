import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendPaginated } from '../../../src/utils/httpResponses';

interface AnalyticsQuery {
  period?: string;
  startDate?: string;
  endDate?: string;
  page?: string;
  limit?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getAnalytics(req, res);
    case 'POST':
      return await generateAnalytics(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getAnalytics(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const {
      period = 'daily',
      startDate = '',
      endDate = '',
      page = '1',
      limit = '30'
    }: AnalyticsQuery = req.query;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return sendBadRequest(res, 'Invalid period. Must be daily, weekly, or monthly');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = { period };

    if (startDate.trim() || endDate.trim()) {
      filter.date = {};
      if (startDate.trim()) {
        filter.date.$gte = new Date(startDate.trim());
      }
      if (endDate.trim()) {
        filter.date.$lte = new Date(endDate.trim());
      }
    }

    const totalCount = await db.collection('onboard_analytics').countDocuments(filter);
    
    const analytics = await db.collection('onboard_analytics')
      .find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    if (analytics.length === 0) {
      const realtimeData = await generateRealtimeAnalytics(db, period);
      return sendSuccess(res, realtimeData, 'Real-time analytics generated successfully');
    }

    const responseData = {
      analytics,
      filters: {
        period,
        startDate: startDate || null,
        endDate: endDate || null
      }
    };

    return sendPaginated(
      res,
      responseData.analytics,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Analytics retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching analytics:', error);
    return sendServerError(res, error, 'Failed to fetch analytics');
  }
}

async function generateAnalytics(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { date, period = 'daily' } = req.body;

    if (!date) {
      return sendBadRequest(res, 'Date is required');
    }

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return sendBadRequest(res, 'Invalid period. Must be daily, weekly, or monthly');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const analyticsDate = new Date(date);
    const { startDate, endDate } = getDateRange(analyticsDate, period);

    const metrics = await calculateMetrics(db, startDate, endDate);

    const existingRecord = await db.collection('onboard_analytics').findOne({
      date: analyticsDate,
      period
    });

    const analyticsData = {
      date: analyticsDate,
      period,
      metrics,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    let result;
    if (existingRecord) {
      await db.collection('onboard_analytics').updateOne(
        { _id: existingRecord._id },
        { $set: { ...analyticsData, updatedAt: new Date() } }
      );
      result = await db.collection('onboard_analytics').findOne({ _id: existingRecord._id });
    } else {
      const insertResult = await db.collection('onboard_analytics').insertOne(analyticsData);
      result = await db.collection('onboard_analytics').findOne({ _id: insertResult.insertedId });
    }

    return sendSuccess(res, result, 'Analytics generated successfully');

  } catch (error) {
    console.error('Error generating analytics:', error);
    return sendServerError(res, error, 'Failed to generate analytics');
  }
}

async function generateRealtimeAnalytics(db: any, period: string) {
  const now = new Date();
  const { startDate, endDate } = getDateRange(now, period);

  const metrics = await calculateMetrics(db, startDate, endDate);

  return {
    date: now,
    period,
    metrics,
    isRealtime: true,
    generatedAt: now
  };
}

function getDateRange(date: Date, period: string) {
  const startDate = new Date(date);
  const endDate = new Date(date);

  switch (period) {
    case 'daily':
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'weekly':
      const dayOfWeek = startDate.getDay();
      startDate.setDate(startDate.getDate() - dayOfWeek);
      startDate.setHours(0, 0, 0, 0);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
      break;
    case 'monthly':
      startDate.setDate(1);
      startDate.setHours(0, 0, 0, 0);
      endDate.setMonth(endDate.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
      break;
  }

  return { startDate, endDate };
}

async function calculateMetrics(db: any, startDate: Date, endDate: Date) {
  const allClients = await db.collection('onboard_clients').find({}).toArray();
  const totalClients = allClients.length;

  const newClients = await db.collection('onboard_clients').countDocuments({
    createdAt: { $gte: startDate, $lte: endDate }
  });

  const completedOnboarding = await db.collection('onboard_progress').countDocuments({
    overallProgress: 100,
    lastUpdated: { $gte: startDate, $lte: endDate }
  });

  const activeOnboarding = await db.collection('onboard_progress').countDocuments({
    overallProgress: { $gt: 0, $lt: 100 }
  });

  const completedClients = await db.collection('onboard_progress').find({
    overallProgress: 100
  }).toArray();

  let averageCompletionTime = 0;
  if (completedClients.length > 0) {
    let totalCompletionTime = 0;
    let validCompletions = 0;

    for (const progress of completedClients) {
      const client = await db.collection('onboard_clients').findOne({ locationId: progress.locationId });
      if (client && client.timeline.startDate && progress.lastUpdated) {
        const completionTime = (progress.lastUpdated.getTime() - client.timeline.startDate.getTime()) / (1000 * 60 * 60 * 24);
        totalCompletionTime += completionTime;
        validCompletions++;
      }
    }

    if (validCompletions > 0) {
      averageCompletionTime = Math.round(totalCompletionTime / validCompletions);
    }
  }

  const allProgress = await db.collection('onboard_progress').find({}).toArray();
  const taskCompletionRate: { [key: string]: number } = {};

  for (let phase = 1; phase <= 4; phase++) {
    const phaseKey = phase.toString();
    let totalTasks = 0;
    let completedTasks = 0;

    allProgress.forEach((progress: any) => {
      const phaseProgress = progress.phaseProgress?.[phaseKey];
      if (phaseProgress) {
        totalTasks += phaseProgress.totalTasks || 0;
        completedTasks += phaseProgress.completedTasks || 0;
      }
    });

    taskCompletionRate[phaseKey] = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  }

  const packageTypeDistribution: { [key: string]: number } = {
    basic: 0,
    premium: 0,
    enterprise: 0
  };

  allClients.forEach((client: any) => {
    if (client.packageType && packageTypeDistribution.hasOwnProperty(client.packageType)) {
      packageTypeDistribution[client.packageType]++;
    }
  });

  return {
    totalClients,
    newClients,
    completedOnboarding,
    activeOnboarding,
    averageCompletionTime,
    taskCompletionRate,
    packageTypeDistribution
  };
} 