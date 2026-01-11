import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../../src/lib/mongodb';
import cors from '../../../../src/lib/cors';
import { ObjectId } from 'mongodb';
import { sendSuccess, sendBadRequest, sendServerError, sendNotFound } from '../../../../src/utils/httpResponses';
import { sendMethodNotAllowed } from '../../../../src/utils/response';

// Email template interfaces
export interface EmailTemplate {
  _id: string;
  name: string;
  category: string;
  subject?: string;
  content: string;
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
  sourceTemplateId?: string;
}

export interface UpdateEmailTemplateRequest {
  name?: string;
  category?: string;
  subject?: string;
  content?: string;
  html?: string;
  description?: string;
  tags?: string[];
  isDefault?: boolean;
  isActive?: boolean;
}

export interface UpdateEmailTemplateResponse {
  success: boolean;
  data?: EmailTemplate;
  message?: string;
  error?: string;
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

  if (req.method !== 'PUT') {
    return sendMethodNotAllowed(res, ['PUT']);
  }

  return await updateEmailTemplate(req, res);
}

async function updateEmailTemplate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.query;
    
    if (!id || typeof id !== 'string') {
      return sendBadRequest(res, 'Template ID is required');
    }

    // Validate ObjectId format
    if (!ObjectId.isValid(id)) {
      return sendBadRequest(res, 'Invalid template ID format');
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Check if template exists
    const existingTemplate = await db.collection('email_templates').findOne({ 
      _id: new ObjectId(id) 
    });

    if (!existingTemplate) {
      return sendNotFound(res, 'Email template not found');
    }

    const updateData: UpdateEmailTemplateRequest = req.body;

    // Validate that at least one field is being updated
    const updateFields = Object.keys(updateData).filter(key => updateData[key as keyof UpdateEmailTemplateRequest] !== undefined);
    if (updateFields.length === 0) {
      return sendBadRequest(res, 'At least one field must be provided for update');
    }

    // Build update object
    const update: any = {
      updatedAt: new Date()
    };

    // Update individual fields if provided
    if (updateData.name !== undefined) update.name = updateData.name;
    if (updateData.category !== undefined) update.category = updateData.category;
    if (updateData.subject !== undefined) update.subject = updateData.subject;
    if (updateData.content !== undefined) update.content = updateData.content;
    if (updateData.html !== undefined) update.html = updateData.html;
    if (updateData.description !== undefined) update.description = updateData.description;
    if (updateData.tags !== undefined) update.tags = updateData.tags;
    if (updateData.isDefault !== undefined) update.isDefault = updateData.isDefault;
    if (updateData.isActive !== undefined) update.isActive = updateData.isActive;

    // Re-extract variables if content, subject, or html changed
    if (updateData.content !== undefined || updateData.subject !== undefined || updateData.html !== undefined) {
      const content = updateData.content !== undefined ? updateData.content : existingTemplate.content;
      const subject = updateData.subject !== undefined ? updateData.subject : existingTemplate.subject;
      const html = updateData.html !== undefined ? updateData.html : existingTemplate.html;
      update.variables = extractVariables(content + ' ' + (subject || '') + ' ' + (html || ''));
    }

    // Increment version
    update.version = (existingTemplate.version || 1) + 1;

    console.log(`[EMAIL TEMPLATE UPDATE] Updating template ${id} with fields:`, updateFields);

    // Perform the update
    const result = await db.collection('email_templates').updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return sendNotFound(res, 'Email template not found');
    }

    if (result.modifiedCount === 0) {
      return sendBadRequest(res, 'No changes were made to the template');
    }

    // Fetch the updated template
    const updatedTemplate = await db.collection('email_templates').findOne({ 
      _id: new ObjectId(id) 
    });

    if (!updatedTemplate) {
      return sendServerError(res, 'Failed to retrieve updated template');
    }

    // Transform to match EmailTemplate interface
    const transformedTemplate: EmailTemplate = {
      _id: updatedTemplate._id.toString(),
      name: updatedTemplate.name,
      category: updatedTemplate.category,
      subject: updatedTemplate.subject,
      content: updatedTemplate.content,
      locationId: updatedTemplate.locationId,
      isGlobal: updatedTemplate.isGlobal || false,
      isDefault: updatedTemplate.isDefault || false,
      isActive: updatedTemplate.isActive !== false,
      variables: updatedTemplate.variables || [],
      description: updatedTemplate.description,
      tags: updatedTemplate.tags || [],
      version: updatedTemplate.version || 1,
      createdAt: updatedTemplate.createdAt,
      updatedAt: updatedTemplate.updatedAt,
      createdBy: updatedTemplate.createdBy,
      sourceTemplateId: updatedTemplate.sourceTemplateId
    };

    const response: UpdateEmailTemplateResponse = {
      success: true,
      data: transformedTemplate,
      message: 'Email template updated successfully'
    };

    console.log(`[EMAIL TEMPLATE UPDATE] Successfully updated template ${id}`);

    return sendSuccess(res, response);

  } catch (error: any) {
    console.error('[EMAIL TEMPLATE UPDATE] Error updating email template:', error);
    return sendServerError(res, 'Failed to update email template', error.message);
  }
}
