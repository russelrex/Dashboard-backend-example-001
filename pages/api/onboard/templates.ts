import type { NextApiRequest, NextApiResponse } from 'next';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '@/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound, sendPaginated } from '../../../src/utils/httpResponses';
import type { OnboardTemplate } from '../../../src/types/onboarding';

interface TemplateQuery {
  page?: string;
  limit?: string;
  packageType?: string;
  isActive?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getTemplates(req, res);
    case 'POST':
      return await createTemplate(req, res);
    case 'PUT':
      return await updateTemplate(req, res);
    case 'DELETE':
      return await deleteTemplate(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function getTemplates(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    const {
      page = '1',
      limit = '10',
      packageType = '',
      isActive = ''
    }: TemplateQuery = req.query;

    if (packageType.trim() && page === '1' && limit === '10') {
      const filter: any = { packageType: packageType.trim() };
      if (isActive.trim()) {
        filter.isActive = isActive === 'true';
      }

      const template = await db.collection('onboard_templates').findOne(filter);
      
      if (!template) {
        return sendNotFound(res, 'Template not found');
      }

      return sendSuccess(res, template, 'Template retrieved successfully');
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    if (packageType.trim()) {
      filter.packageType = packageType.trim();
    }

    if (isActive.trim()) {
      filter.isActive = isActive === 'true';
    }

    const totalCount = await db.collection('onboard_templates').countDocuments(filter);
    
    const templates = await db.collection('onboard_templates')
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const responseData = {
      templates,
      filters: {
        packageType: packageType || null,
        isActive: isActive || null
      }
    };

    return sendPaginated(
      res,
      responseData.templates,
      {
        page: pageNum,
        limit: limitNum,
        total: totalCount
      },
      'Templates retrieved successfully'
    );

  } catch (error) {
    console.error('Error fetching templates:', error);
    return sendServerError(res, error, 'Failed to fetch templates');
  }
}

async function createTemplate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const templateData: Omit<OnboardTemplate, '_id' | 'createdAt' | 'updatedAt'> = req.body;

    if (!templateData.packageType || !templateData.name || !templateData.phases) {
      return sendBadRequest(res, 'Missing required fields: packageType, name, phases');
    }

    if (!['basic', 'premium', 'enterprise'].includes(templateData.packageType)) {
      return sendBadRequest(res, 'Invalid package type. Must be basic, premium, or enterprise');
    }

    if (!Array.isArray(templateData.phases) || templateData.phases.length === 0) {
      return sendBadRequest(res, 'Phases must be a non-empty array');
    }

    for (const phase of templateData.phases) {
      if (!phase.id || !phase.title || !phase.tasks || !Array.isArray(phase.tasks)) {
        return sendBadRequest(res, 'Each phase must have id, title, and tasks array');
      }

      for (const task of phase.tasks) {
        if (!task.id || !task.name) {
          return sendBadRequest(res, 'Each task must have id and name');
        }

        const taskIdRegex = /^P[1-4]_T\d{2}$/;
        if (!taskIdRegex.test(task.id)) {
          return sendBadRequest(res, `Invalid task ID format: ${task.id}. Must be P{1-4}_T{01-99}`);
        }
      }
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const existingTemplate = await db.collection('onboard_templates').findOne({ 
      packageType: templateData.packageType 
    });

    if (existingTemplate) {
      return sendBadRequest(res, 'Template for this package type already exists. Use PUT to update.');
    }

    const totalTasks = templateData.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);

    const newTemplate: OnboardTemplate = {
      ...templateData,
      totalTasks,
      isActive: templateData.isActive !== false, // Default to true
      version: templateData.version || '1.0',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('onboard_templates').insertOne(newTemplate as any);
    const createdTemplate = await db.collection('onboard_templates').findOne({ _id: result.insertedId });

    return sendSuccess(res, createdTemplate, 'Template created successfully');

  } catch (error) {
    console.error('Error creating template:', error);
    return sendServerError(res, error, 'Failed to create template');
  }
}

async function updateTemplate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { templateId } = req.query;
    const updateData: Partial<OnboardTemplate> = req.body;

    if (!templateId) {
      return sendBadRequest(res, 'Template ID is required');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const existingTemplate = await db.collection('onboard_templates').findOne({ 
      _id: new ObjectId(templateId as string) 
    });

    if (!existingTemplate) {
      return sendNotFound(res, 'Template not found');
    }

    const updateFields: any = {
      updatedAt: new Date()
    };

    if (updateData.name) updateFields.name = updateData.name;
    if (updateData.description !== undefined) updateFields.description = updateData.description;
    if (updateData.estimatedDuration) updateFields.estimatedDuration = updateData.estimatedDuration;
    if (updateData.isActive !== undefined) updateFields.isActive = updateData.isActive;
    if (updateData.version) updateFields.version = updateData.version;

    if (updateData.phases) {
      if (!Array.isArray(updateData.phases) || updateData.phases.length === 0) {
        return sendBadRequest(res, 'Phases must be a non-empty array');
      }

      for (const phase of updateData.phases) {
        if (!phase.id || !phase.title || !phase.tasks || !Array.isArray(phase.tasks)) {
          return sendBadRequest(res, 'Each phase must have id, title, and tasks array');
        }

        for (const task of phase.tasks) {
          if (!task.id || !task.name) {
            return sendBadRequest(res, 'Each task must have id and name');
          }

          const taskIdRegex = /^P[1-4]_T\d{2}$/;
          if (!taskIdRegex.test(task.id)) {
            return sendBadRequest(res, `Invalid task ID format: ${task.id}. Must be P{1-4}_T{01-99}`);
          }
        }
      }

      updateFields.phases = updateData.phases;
      updateFields.totalTasks = updateData.phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
    }

    await db.collection('onboard_templates').updateOne(
      { _id: new ObjectId(templateId as string) },
      { $set: updateFields }
    );

    const updatedTemplate = await db.collection('onboard_templates').findOne({ 
      _id: new ObjectId(templateId as string) 
    });

    return sendSuccess(res, updatedTemplate, 'Template updated successfully');

  } catch (error) {
    console.error('Error updating template:', error);
    return sendServerError(res, error, 'Failed to update template');
  }
}

async function deleteTemplate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { templateId } = req.query;

    if (!templateId) {
      return sendBadRequest(res, 'Template ID is required');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    const existingTemplate = await db.collection('onboard_templates').findOne({ 
      _id: new ObjectId(templateId as string) 
    });

    if (!existingTemplate) {
      return sendNotFound(res, 'Template not found');
    }

    const clientsUsingTemplate = await db.collection('onboard_clients').countDocuments({ 
      packageType: existingTemplate.packageType 
    });

    if (clientsUsingTemplate > 0) {
      return sendBadRequest(res, 'Cannot delete template that is being used by existing clients. Consider deactivating instead.');
    }

    await db.collection('onboard_templates').deleteOne({ 
      _id: new ObjectId(templateId as string) 
    });

    return sendSuccess(res, { deletedId: templateId }, 'Template deleted successfully');

  } catch (error) {
    console.error('Error deleting template:', error);
    return sendServerError(res, error, 'Failed to delete template');
  }
} 