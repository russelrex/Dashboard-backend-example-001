import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '../../../src/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError } from '../../../src/utils/httpResponses';
import { sendMethodNotAllowed } from '../../../src/utils/response';

// Email template interfaces
export interface EmailTemplateFilters {
  category?: string;
  isGlobal?: boolean;
  locationId?: string;
  isDefault?: boolean;
}

export interface EmailTemplate {
  _id: string;
  name: string;
  category: string;
  subject?: string;
  previewText?: string;
  content: string;
  html?: string;
  locationId?: string;
  isGlobal: boolean;
  isDefault?: boolean;
  isActive: boolean;
  variables?: string[];
  description?: string;
  tags?: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  sourceTemplateId?: string; // For copied templates
}

export interface GetEmailTemplatesResponse {
  success: boolean;
  data?: EmailTemplate[];
  error?: string;
}

export interface CreateEmailTemplateRequest {
  name: string;
  category: string;
  subject?: string;
  previewText?: string;
  content: string;
  html?: string;
  description?: string;
  tags?: string[];
  isDefault?: boolean;
  locationId?: string;
  isGlobal?: boolean;
  createdBy?: string;
  sourceTemplateId?: string;
}

export interface UpdateEmailTemplateRequest {
  name?: string;
  category?: string;
  subject?: string;
  previewText?: string;
  content?: string;
  html?: string;
  description?: string;
  tags?: string[];
  isDefault?: boolean;
  isActive?: boolean;
}

function extractVariables(content: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const variables = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    variables.push(match[1].trim());
  }
  return [...new Set(variables)];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  switch (req.method) {
    case 'GET':
      return await getEmailTemplates(req, res);
    case 'POST':
      return await createEmailTemplate(req, res);
    default:
      return sendMethodNotAllowed(res, ['GET', 'POST']);
  }
}

async function getEmailTemplates(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    // Parse query parameters into filters
    const filters: EmailTemplateFilters = {};
    
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

    console.log('[EMAIL TEMPLATES API] Filters applied:', filters);

    // Build MongoDB query based on filters
    const query: any = {};

    // Apply filters
    if (filters.category) {
      query.category = filters.category;
    }

    if (filters.isGlobal !== undefined) {
      query.isGlobal = filters.isGlobal;
    }

    if (filters.locationId) {
      query.locationId = filters.locationId;
    }

    if (filters.isDefault !== undefined) {
      query.isDefault = filters.isDefault;
    }

    // If no specific locationId filter, get both global and location-specific templates
    if (!filters.locationId && filters.isGlobal === undefined) {
      // This will get all active templates (both global and location-specific)
      // We'll handle the logic to show appropriate templates based on context
    }

    console.log('[EMAIL TEMPLATES API] MongoDB query:', JSON.stringify(query, null, 2));

    // Execute the query
    const templates = await db.collection('email_templates')
      .find(query)
      .sort({ 
        isGlobal: 1, // Global templates first
        category: 1, // Then by category
        name: 1      // Then by name
      })
      .toArray();

    console.log(`[EMAIL TEMPLATES API] Found ${templates.length} templates`);

    // Transform templates to match EmailTemplate interface
    const transformedTemplates: EmailTemplate[] = templates.map(template => ({
      _id: template._id.toString(),
      name: template.name,
      category: template.category,
      subject: template.subject,
      previewText: template.previewText,
      content: template.content,
      html: template.html,
      locationId: template.locationId,
      isGlobal: template.isGlobal || false,
      isDefault: template.isDefault || false,
      isActive: template.isActive !== false,
      variables: template.variables || [],
      description: template.description,
      tags: template.tags || [],
      version: template.version || 1,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      createdBy: template.createdBy,
      sourceTemplateId: template.sourceTemplateId
    }));

    const response: GetEmailTemplatesResponse = {
      success: true,
      data: transformedTemplates
    };

    return sendSuccess(res, response);

  } catch (error: any) {
    console.error('[EMAIL TEMPLATES API] Error fetching email templates:', error);
    return sendServerError(res, 'Failed to fetch email templates', error.message);
  }
}

async function createEmailTemplate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const templateData: CreateEmailTemplateRequest = req.body;

    // Validate required fields
    if (!templateData.name || !templateData.category || !templateData.content) {
      return sendBadRequest(res, 'Missing required fields: name, category, and content are required');
    }

    // Extract variables from content, subject, previewText, and html
    const variables = extractVariables(
      templateData.content + ' ' + 
      (templateData.subject || '') + ' ' + 
      (templateData.previewText || '') + ' ' + 
      (templateData.html || '')
    );

    const template = {
      ...templateData,
      variables,
      isActive: true,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('email_templates').insertOne(template);

    const createdTemplate: EmailTemplate = {
      _id: result.insertedId.toString(),
      name: template.name,
      category: template.category,
      subject: template.subject,
      previewText: template.previewText,
      content: template.content,
      html: template.html,
      locationId: template.locationId,
      isGlobal: template.isGlobal || false,
      isDefault: template.isDefault || false,
      isActive: template.isActive,
      variables: template.variables,
      description: template.description,
      tags: template.tags || [],
      version: template.version,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      createdBy: template.createdBy,
      sourceTemplateId: template.sourceTemplateId
    };

    const response = {
      success: true,
      data: createdTemplate,
      message: 'Email template created successfully'
    };

    return sendSuccess(res, response);

  } catch (error: any) {
    console.error('[EMAIL TEMPLATES API] Error creating email template:', error);
    return sendServerError(res, 'Failed to create email template', error.message);
  }
}
