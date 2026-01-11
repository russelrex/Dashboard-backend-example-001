import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound, sendPaginated } from '../../../src/utils/httpResponses';
import type { OnboardClient, CreateClientRequest, UpdateClientRequest, ClientsQuery } from '../../../src/types/onboarding';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getClients(req, res);
    case 'POST':
      return await createClient(req, res);
    case 'PUT':
      return await updateClient(req, res);
    case 'DELETE':
      return await deleteClient(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getClients(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const {
      page = '1',
      limit = '20',
      search = '',
      status = '',
      packageType = '',
      priority = '',
      assignedTeam = ''
    }: ClientsQuery = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    if (search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      filter.$or = [
        { 'clientInfo.companyName': searchRegex },
        { 'clientInfo.contactPerson': searchRegex },
        { 'clientInfo.email': searchRegex },
        { 'clientInfo.phone': searchRegex },
        { notes: searchRegex }
      ];
    }

    if (status.trim()) {
      filter.status = status.trim();
    }

    if (packageType.trim()) {
      filter.packageType = packageType.trim();
    }

    if (priority.trim()) {
      filter['metadata.priority'] = priority.trim();
    }

    if (assignedTeam.trim()) {
      filter.assignedTeam = { $in: [assignedTeam.trim()] };
    }

    const totalCount = await db.collection('onboard_clients').countDocuments(filter);
    
    const clients = await db.collection('onboard_clients')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const formattedClients = clients.map(client => ({
      _id: client._id,
      locationId: client.locationId,
      clientInfo: client.clientInfo,
      packageType: client.packageType,
      timeline: client.timeline,
      status: client.status,
      assignedTeam: client.assignedTeam,
      notes: client.notes || '',
      metadata: client.metadata,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt
    }));

    const responseData = {
      clients: formattedClients,
      filters: {
        search: search || null,
        status: status || null,
        packageType: packageType || null,
        priority: priority || null,
        assignedTeam: assignedTeam || null
      }
    };

    return sendPaginated(
      res,
      responseData.clients,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Onboard clients retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching onboard clients:', error);
    return sendServerError(res, error, 'Failed to fetch onboard clients');
  }
}

async function createClient(req: NextApiRequest, res: NextApiResponse) {
  try {
    const clientData: CreateClientRequest = req.body;

    if (!clientData.locationId || !clientData.clientInfo || !clientData.packageType || !clientData.timeline) {
      return sendBadRequest(res, 'Missing required fields: locationId, clientInfo, packageType, timeline');
    }

    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(clientData.clientInfo.email)) {
      return sendBadRequest(res, 'Invalid email format');
    }

    if (!['basic', 'premium', 'enterprise'].includes(clientData.packageType)) {
      return sendBadRequest(res, 'Invalid package type. Must be basic, premium, or enterprise');
    }

    const startDate = new Date(clientData.timeline.startDate);
    const estimatedCompletion = new Date(clientData.timeline.estimatedCompletion);
    
    if (isNaN(startDate.getTime()) || isNaN(estimatedCompletion.getTime())) {
      return sendBadRequest(res, 'Invalid date format in timeline');
    }

    if (estimatedCompletion <= startDate) {
      return sendBadRequest(res, 'Estimated completion date must be after start date');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const existingClient = await db.collection('onboard_clients').findOne({ locationId: clientData.locationId });
    if (existingClient) {
      return sendBadRequest(res, 'Client with this locationId already exists');
    }

    const newClient: OnboardClient = {
      locationId: clientData.locationId,
      clientInfo: {
        ...clientData.clientInfo,
        email: clientData.clientInfo.email.toLowerCase().trim()
      },
      packageType: clientData.packageType,
      timeline: {
        startDate,
        estimatedCompletion
      },
      status: 'pending',
      assignedTeam: clientData.assignedTeam || [],
      notes: clientData.notes || '',
      metadata: {
        priority: clientData.metadata?.priority || 'medium',
        tags: clientData.metadata?.tags || [],
        source: clientData.metadata?.source || '',
        salesRep: clientData.metadata?.salesRep || ''
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('onboard_clients').insertOne(newClient as any);

    await initializeProgress(db, clientData.locationId, clientData.packageType);

    const createdClient = await db.collection('onboard_clients').findOne({ _id: result.insertedId });

    return sendSuccess(res, createdClient, 'Onboard client created successfully');

  } catch (error) {
    console.error('Error creating onboard client:', error);
    return sendServerError(res, error, 'Failed to create onboard client');
  } 
}

async function updateClient(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { clientId } = req.query;
    const updateData: UpdateClientRequest = req.body;

    if (!clientId) {
      return sendBadRequest(res, 'Client ID is required');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const existingClient = await db.collection('onboard_clients').findOne({ 
      _id: new ObjectId(clientId as string) 
    });

    if (!existingClient) {
      return sendNotFound(res, 'Onboard client not found');
    }

    const updateFields: any = {
      updatedAt: new Date()
    };

    if (updateData.clientInfo) {
      updateFields.clientInfo = { ...existingClient.clientInfo, ...updateData.clientInfo };
      if (updateData.clientInfo.email) {
        updateFields.clientInfo.email = updateData.clientInfo.email.toLowerCase().trim();
      }
    }

    if (updateData.packageType) updateFields.packageType = updateData.packageType;
    if (updateData.status) updateFields.status = updateData.status;
    if (updateData.assignedTeam) updateFields.assignedTeam = updateData.assignedTeam;
    if (updateData.notes !== undefined) updateFields.notes = updateData.notes;

    if (updateData.timeline) {
      updateFields.timeline = { ...existingClient.timeline };
      if (updateData.timeline.startDate) {
        updateFields.timeline.startDate = new Date(updateData.timeline.startDate);
      }
      if (updateData.timeline.estimatedCompletion) {
        updateFields.timeline.estimatedCompletion = new Date(updateData.timeline.estimatedCompletion);
      }
      if (updateData.timeline.actualCompletion) {
        updateFields.timeline.actualCompletion = new Date(updateData.timeline.actualCompletion);
      }
    }

    if (updateData.metadata) {
      updateFields.metadata = { ...existingClient.metadata, ...updateData.metadata };
    }

    await db.collection('onboard_clients').updateOne(
      { _id: new ObjectId(clientId as string) },
      { $set: updateFields }
    );

    const updatedClient = await db.collection('onboard_clients').findOne({ 
      _id: new ObjectId(clientId as string) 
    });

    return sendSuccess(res, updatedClient, 'Onboard client updated successfully');

  } catch (error) {
    console.error('Error updating onboard client:', error);
    return sendServerError(res, error, 'Failed to update onboard client');
  }
}

async function deleteClient(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { clientId } = req.query;

    if (!clientId) {
      return sendBadRequest(res, 'Client ID is required');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const existingClient = await db.collection('onboard_clients').findOne({ 
      _id: new ObjectId(clientId as string) 
    });

    if (!existingClient) {
      return sendNotFound(res, 'Onboard client not found');
    }

    await db.collection('onboard_clients').deleteOne({ 
      _id: new ObjectId(clientId as string) 
    });

    await db.collection('onboard_progress').deleteOne({ locationId: existingClient.locationId });
    await db.collection('onboard_task_logs').deleteMany({ locationId: existingClient.locationId });

    return sendSuccess(res, { deletedId: clientId }, 'Onboard client deleted successfully');

  } catch (error) {
    console.error('Error deleting onboard client:', error);
    return sendServerError(res, error, 'Failed to delete onboard client');
  }
}

async function initializeProgress(db: any, locationId: string, packageType: string) {
  try {
    const template = await db.collection('onboard_templates').findOne({ 
      packageType, 
      isActive: true 
    });

    const defaultPhaseCounts: { [key: string]: number } = {
      '1': 11,
      '2': 9,
      '3': 9,
      '4': 9
    };

    let phaseCounts = defaultPhaseCounts;
    if (template && template.phases) {
      phaseCounts = {};
      template.phases.forEach((phase: any) => {
        phaseCounts[phase.id.toString()] = phase.tasks.length;
      });
    }

    const phaseProgress: any = {};
    Object.keys(phaseCounts).forEach(phaseId => {
      phaseProgress[phaseId] = {
        completedTasks: 0,
        totalTasks: phaseCounts[phaseId],
        percentage: 0,
        status: 'pending'
      };
    });

    const progressData = {
      locationId,
      completedTaskIds: [],
      phaseProgress,
      overallProgress: 0,
      currentPhase: 1,
      lastUpdated: new Date(),
      milestones: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await db.collection('onboard_progress').insertOne(progressData);
  } catch (error) {
    console.error('Error initializing progress:', error);
  }
} 