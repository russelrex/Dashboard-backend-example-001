import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '../../../src/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError } from '../../../src/utils/httpResponses';
import { sendMethodNotAllowed } from '../../../src/utils/response';
import { TemplateFilters, GetTemplatesResponse, Template } from '../../../src/interfaces/templates';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method !== 'GET') {
    return sendMethodNotAllowed(res, ['GET']);
  }

  return await getTemplates(req, res);
}

async function getTemplates(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Parse query parameters into filters
    const filters: TemplateFilters = {};
    
    if (req.query.category) {
      filters.category = req.query.category as string;
    }
    
    if (req.query.isGlobal !== undefined) {
      filters.isGlobal = req.query.isGlobal === 'true';
    }
    
    if (req.query.locationId) {
      filters.locationId = req.query.locationId as string;
    }
    
    if (req.query.isDefault !== undefined) {
      filters.isDefault = req.query.isDefault === 'true';
    }

    console.log('[TEMPLATES API] Filters applied:', filters);

    // Build MongoDB query based on filters
    const query: any = {};

    // Apply filters
    if (filters.category) {
      query.category = filters.category;
    }

    if (filters.isDefault !== undefined) {
      query.isDefault = filters.isDefault;
    }

    // Handle isGlobal and locationId with OR logic
    if (filters.isGlobal !== undefined && filters.locationId) {
      // If both isGlobal and locationId are specified, use OR condition
      query.$or = [
        { isGlobal: filters.isGlobal },
        { locationId: filters.locationId }
      ];
    } else if (filters.isGlobal !== undefined) {
      // Only isGlobal filter
      query.isGlobal = filters.isGlobal;
    } else if (filters.locationId) {
      // Only locationId filter - get both global and location-specific
      query.$or = [
        { isGlobal: true },
        { locationId: filters.locationId }
      ];
    }
    // If neither isGlobal nor locationId are specified, get all templates

    console.log('[TEMPLATES API] MongoDB query:', JSON.stringify(query, null, 2));

    // Execute the query
    const templates = await db.collection('templates')
      .find(query)
      .sort({ 
        isGlobal: 1, // Global templates first
        category: 1, // Then by category
        name: 1      // Then by name
      })
      .toArray();

    console.log(`[TEMPLATES API] Found ${templates.length} templates`);

    // Transform templates to match Template interface
    const transformedTemplates: Template[] = templates.map(template => ({
      _id: template._id.toString(),
      name: template.name,
      category: template.category,
      locationId: template.locationId,
      isGlobal: template.isGlobal || false,
      isDefault: template.isDefault || false,
      isActive: template.isActive !== false,
      tabs: template.tabs || [],
      sections: template.sections || [],
      content: template.content,
      description: template.description,
      tags: template.tags || [],
      version: template.version || 1,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      createdBy: template.createdBy,
      sourceTemplateId: template.sourceTemplateId
    }));

    const response: GetTemplatesResponse = {
      success: true,
      data: transformedTemplates
    };

    return sendSuccess(res, response);

  } catch (error: any) {
    console.error('[TEMPLATES API] Error fetching templates:', error);
    return sendServerError(res, 'Failed to fetch templates', error.message);
  }
}
