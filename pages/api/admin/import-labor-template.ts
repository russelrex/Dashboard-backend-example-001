// pages/api/admin/import-labor-template.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

// Auth middleware
async function verifyAuth(req: NextApiRequest) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authUser = await verifyAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    // Check permissions
    const user = await db.collection('users').findOne({
      _id: new ObjectId(authUser._id)
    });

    if (!['admin', 'owner', 'manager'].includes(user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { 
      templateId,
      locationId,
      customizations,
      effectiveDate,
      notes
    } = req.body;

    if (!templateId || !locationId) {
      return res.status(400).json({ error: 'Template ID and Location ID required' });
    }

    // Get the template
    const template = await db.collection('labor_templates').findOne({
      _id: new ObjectId(templateId),
      active: true
    });

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check location access
    const location = await db.collection('locations').findOne({
      _id: new ObjectId(locationId)
    });

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Expire current rules for location
    await db.collection('labor_rules').updateMany(
      { 
        locationId,
        expiryDate: null 
      },
      { 
        $set: { 
          expiryDate: new Date(),
          expiredBy: authUser.userId,
          expiredAt: new Date(),
          replacedByTemplate: template._id
        } 
      }
    );

    // Merge template with customizations
    let rules = { ...template.rules };
    
    if (customizations) {
      // Apply customizations to template rules
      Object.keys(customizations).forEach(key => {
        if (rules[key]) {
          rules[key] = { ...rules[key], ...customizations[key] };
        } else {
          rules[key] = customizations[key];
        }
      });
    }

    // Create new labor rules from template
    const newRules = {
      _id: new ObjectId(),
      locationId,
      ruleName: `${template.name} - ${location.name}`,
      rules,
      sourceTemplate: {
        templateId: template._id,
        templateName: template.name,
        templateVersion: template.version,
        jurisdiction: template.jurisdiction
      },
      customizations: customizations || {},
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      expiryDate: null,
      createdBy: authUser.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: notes || `Imported from template: ${template.name}`,
      version: 1
    };

    await db.collection('labor_rules').insertOne(newRules);

    // Log the import
    await db.collection('activity_logs').insertOne({
      _id: new ObjectId(),
      type: 'labor_template_imported',
      userId: authUser.userId,
      locationId,
      timestamp: new Date(),
      metadata: {
        templateId: template._id,
        templateName: template.name,
        rulesId: newRules._id,
        customizations: Object.keys(customizations || {})
      }
    });

    // Update location with template info
    await db.collection('locations').updateOne(
      { _id: new ObjectId(locationId) },
      { 
        $set: { 
          currentLaborRulesId: newRules._id,
          laborJurisdiction: template.jurisdiction,
          lastLaborRulesUpdate: new Date()
        } 
      }
    );

    return res.status(200).json({
      success: true,
      rules: newRules,
      message: `Successfully imported ${template.name} for ${location.name}`
    });

  } catch (error: any) {
    console.error('Template import error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

// Example usage:
/*
POST /api/admin/import-labor-template
{
  "templateId": "507f1f77bcf86cd799439011",
  "locationId": "507f1f77bcf86cd799439012",
  "customizations": {
    "overtime": {
      "weeklyThreshold": 35  // Custom threshold for this location
    },
    "mileage": {
      "reimbursementRate": 0.70  // Higher than template
    }
  },
  "effectiveDate": "2024-02-01",
  "notes": "Customized OT threshold for union agreement"
}
*/