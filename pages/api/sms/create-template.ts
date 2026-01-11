import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import cors from '../../../src/lib/cors';
import { sendSuccess, sendBadRequest, sendServerError } from '../../../src/utils/httpResponses';
import { sendMethodNotAllowed } from '../../../src/utils/response';

export interface CreateSmsTemplateRequest {
  templateKey: string;
  message: string;
  locationId?: string;
  modifiedBy?: string;
}

export interface UpdateSmsTemplateRequest {
  templateKey: string;
  message: string;
  locationId?: string;
  modifiedBy?: string;
}

export interface SmsTemplateMessage {
  message: string;
  lastModified: Date;
  modifiedBy: string;
}

export interface SmsTemplateDocument {
  _id: string;
  locationId: string;
  isActive: boolean;
  templates: Record<string, SmsTemplateMessage>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSmsTemplateResponse {
  success: boolean;
  data?: SmsTemplateDocument;
  message?: string;
  error?: string;
}

export interface UpdateSmsTemplateResponse {
  success: boolean;
  data?: SmsTemplateDocument;
  message?: string;
  error?: string;
}

export interface GetTemplatesResponse {
  success: boolean;
  data?: SmsTemplateDocument;
  message?: string;
  error?: string;
}

const DEFAULT_TEMPLATES = {
  'on-way': {
    message: 'Hi {contactFirstName}, this is {userName} from {locationName}. I\'m on my way to your appointment and should arrive in approximately {eta} minutes.',
    lastModified: new Date(),
    modifiedBy: 'system'
  },
  'running-late': {
    message: 'Hi {contactFirstName}, this is {userName} from {locationName}. I\'m running about {lateMinutes} minutes behind schedule. My new arrival time is approximately {newTime}. Sorry for the delay!',
    lastModified: new Date(),
    modifiedBy: 'system'
  },
  'arrived': {
    message: 'Hi {contactFirstName}, this is {userName} from {locationName}. I\'ve arrived at your location for our {appointmentTitle} appointment.',
    lastModified: new Date(),
    modifiedBy: 'system'
  },
  'appointment-reminder': {
    message: 'Hi {contactFirstName}, this is a reminder about your {appointmentTitle} appointment tomorrow at {appointmentTime} with {locationName}.',
    lastModified: new Date(),
    modifiedBy: 'system'
  },
  'quote-sent': {
    message: 'Hi {contactFirstName}, your quote for {projectTitle} is ready! View it here: {quoteLink}',
    lastModified: new Date(),
    modifiedBy: 'system'
  },
  'payment-received': {
    message: 'Hi {contactFirstName}, we\'ve received your payment of {amount}. Thank you for your business!',
    lastModified: new Date(),
    modifiedBy: 'system'
  },
  'job-complete': {
    message: 'Hi {contactFirstName}, we\'ve completed the work on your {projectTitle}. Thank you for choosing {locationName}!',
    lastModified: new Date(),
    modifiedBy: 'system'
  }
};

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
      return await getTemplates(req, res);
    case 'POST':
      return await createSmsTemplate(req, res);
    case 'PUT':
      return await updateSmsTemplate(req, res);
    default:
      return sendMethodNotAllowed(res, ['GET', 'POST', 'PUT']);
  }
}

async function createSmsTemplate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const templateData: CreateSmsTemplateRequest = req.body;

    if (!templateData.templateKey || !templateData.message) {
      return sendBadRequest(res, 'Missing required fields: templateKey and message are required');
    }

    const locationId = templateData.locationId || 'global';
    const modifiedBy = templateData.modifiedBy || 'system';

    const templateMessage: SmsTemplateMessage = {
      message: templateData.message,
      lastModified: new Date(),
      modifiedBy: modifiedBy
    };

    const existingDoc = await db.collection('sms_templates').findOne({ locationId: locationId });

    let result;

    if (!existingDoc) {
      const defaultTemplates = { ...DEFAULT_TEMPLATES };
      (defaultTemplates as any)[templateData.templateKey] = templateMessage;

      result = await db.collection('sms_templates').insertOne({
        locationId: locationId,
        isActive: true,
        templates: defaultTemplates,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      result = await db.collection('sms_templates').findOne({ _id: result.insertedId });
    } else {
      result = await db.collection('sms_templates').findOneAndUpdate(
        { locationId: locationId },
        {
          $set: {
            [`templates.${templateData.templateKey}`]: templateMessage,
            isActive: true,
            updatedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );
    }

    if (!result) {
      return sendServerError(res, 'Failed to create or update SMS template', 'Database operation returned null');
    }

    const createdTemplate: SmsTemplateDocument = {
      _id: result._id.toString(),
      locationId: result.locationId,
      isActive: result.isActive,
      templates: result.templates,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    };

    const response: CreateSmsTemplateResponse = {
      success: true,
      data: createdTemplate,
      message: 'SMS template created successfully'
    };

    console.log('[SMS CREATE API] Template created:', {
      id: result._id,
      templateKey: templateData.templateKey,
      locationId: locationId,
      modifiedBy: modifiedBy
    });

    return sendSuccess(res, response);

  } catch (error: any) {
    console.error('[SMS CREATE API] Error creating SMS template:', error);
    return sendServerError(res, 'Failed to create SMS template', error.message);
  }
}

async function updateSmsTemplate(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const templateData: UpdateSmsTemplateRequest = req.body;

    if (!templateData.templateKey || !templateData.message) {
      return sendBadRequest(res, 'Missing required fields: templateKey and message are required');
    }

    const locationId = templateData.locationId || 'global';
    const modifiedBy = templateData.modifiedBy || 'system';

    const templateMessage: SmsTemplateMessage = {
      message: templateData.message,
      lastModified: new Date(),
      modifiedBy: modifiedBy
    };

    const existingDoc = await db.collection('sms_templates').findOne({ locationId: locationId });

    if (!existingDoc) {
      return sendBadRequest(res, 'Template document not found for the specified locationId');
    }

    const result = await db.collection('sms_templates').findOneAndUpdate(
      { locationId: locationId },
      {
        $set: {
          [`templates.${templateData.templateKey}`]: templateMessage,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return sendServerError(res, 'Failed to update SMS template', 'Database operation returned null');
    }

    const updatedTemplate: SmsTemplateDocument = {
      _id: result._id.toString(),
      locationId: result.locationId,
      isActive: result.isActive,
      templates: result.templates,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    };

    const response: UpdateSmsTemplateResponse = {
      success: true,
      data: updatedTemplate,
      message: 'SMS template updated successfully'
    };

    console.log('[SMS UPDATE API] Template updated:', {
      id: result._id,
      templateKey: templateData.templateKey,
      locationId: locationId,
      modifiedBy: modifiedBy
    });

    return sendSuccess(res, response);

  } catch (error: any) {
    console.error('[SMS UPDATE API] Error updating SMS template:', error);
    return sendServerError(res, 'Failed to update SMS template', error.message);
  }
}

async function getTemplates(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());

    const { locationId } = req.query;

    let result;

    if (locationId && typeof locationId === 'string') {
      result = await db.collection('sms_templates').findOne({ 
        locationId: locationId,
        isActive: true 
      });

      if (result) {
        console.log(`[SMS GET API] Found templates for locationId: ${locationId}`);
      } else {
        console.log(`[SMS GET API] No templates found for locationId: ${locationId}, falling back to global`);
      }
    }

    if (!result) {
      result = await db.collection('sms_templates').findOne({ 
        locationId: 'global',
        isActive: true 
      });

      if (result) {
        console.log('[SMS GET API] Found global templates');
      } else {
        console.log('[SMS GET API] No global templates found, returning default templates');
        result = {
          _id: 'default',
          locationId: 'global',
          isActive: true,
          templates: DEFAULT_TEMPLATES,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }
    }

    const response: GetTemplatesResponse = {
      success: true,
      data: {
        _id: result._id.toString(),
        locationId: result.locationId,
        isActive: result.isActive,
        templates: result.templates,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt
      },
      message: 'Templates retrieved successfully'
    };

    return sendSuccess(res, response);

  } catch (error: any) {
    console.error('[SMS GET API] Error fetching templates:', error);
    return sendServerError(res, 'Failed to fetch templates', error.message);
  }
}
