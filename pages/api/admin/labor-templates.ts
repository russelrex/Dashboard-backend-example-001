// pages/api/admin/labor-templates.ts
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
  try {
    // Verify authentication
    const authUser = await verifyAuth(req);
    if (!authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const client = await clientPromise;
    const db = client.db(getDbName());

    switch (req.method) {
      case 'GET': {
        const { 
          templateId,
          jurisdiction,
          category,
          search,
          page = 1,
          limit = 20 
        } = req.query;

        // Get specific template
        if (templateId) {
          const template = await db.collection('labor_templates').findOne({
            _id: new ObjectId(templateId as string),
            active: true
          });

          if (!template) {
            return res.status(404).json({ error: 'Template not found' });
          }

          return res.status(200).json(template);
        }

        // Build query
        const query: any = { active: true };

        if (jurisdiction) {
          query.jurisdiction = jurisdiction as string;
        }

        if (category) {
          query.category = category as string;
        }

        if (search) {
          query.$or = [
            { name: { $regex: search as string, $options: 'i' } },
            { description: { $regex: search as string, $options: 'i' } },
            { tags: { $in: [(search as string).toLowerCase()] } }
          ];
        }

        // Get templates with pagination
        const skip = (Number(page) - 1) * Number(limit);
        
        const [templates, total] = await Promise.all([
          db.collection('labor_templates')
            .find(query)
            .sort({ jurisdiction: 1, name: 1 })
            .skip(skip)
            .limit(Number(limit))
            .toArray(),
          db.collection('labor_templates').countDocuments(query)
        ]);

        // Get available jurisdictions and categories
        const [jurisdictions, categories] = await Promise.all([
          db.collection('labor_templates').distinct('jurisdiction', { active: true }),
          db.collection('labor_templates').distinct('category', { active: true })
        ]);

        return res.status(200).json({
          templates,
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total,
            pages: Math.ceil(total / Number(limit))
          },
          filters: {
            jurisdictions: jurisdictions.sort(),
            categories: categories.sort()
          }
        });
      }

      case 'POST': {
        // Create new template (admin only)
        const user = await db.collection('users').findOne({
          _id: new ObjectId(authUser._id)
        });

        if (!['admin', 'owner'].includes(user?.role)) {
          return res.status(403).json({ error: 'Only admins can create templates' });
        }

        const {
          name,
          description,
          jurisdiction,
          category,
          effectiveDate,
          expiryDate,
          rules,
          tags,
          metadata,
          isOfficial
        } = req.body;

        // Validate required fields
        if (!name || !jurisdiction || !category || !rules) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check for duplicate
        const existing = await db.collection('labor_templates').findOne({
          name,
          jurisdiction,
          active: true
        });

        if (existing) {
          return res.status(409).json({ error: 'Template already exists' });
        }

        const newTemplate = {
          _id: new ObjectId(),
          name,
          description: description || '',
          jurisdiction, // e.g., 'US-CA', 'US-NY', 'US-Federal'
          category, // e.g., 'state', 'federal', 'city', 'custom'
          effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          rules: {
            overtime: rules.overtime || {},
            breaks: rules.breaks || {},
            mileage: rules.mileage || {},
            minimumWage: rules.minimumWage || {},
            scheduling: rules.scheduling || {},
            pto: rules.pto || {},
            holidays: rules.holidays || [],
            sick: rules.sick || {},
            // Additional rule categories
            finalPay: rules.finalPay || {},
            recordKeeping: rules.recordKeeping || {},
            youthEmployment: rules.youthEmployment || {}
          },
          tags: tags || [],
          metadata: metadata || {
            source: 'manual',
            lastReviewedDate: new Date(),
            reviewedBy: authUser.userId,
            notes: ''
          },
          isOfficial: isOfficial || false,
          active: true,
          version: 1,
          createdBy: authUser.userId,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await db.collection('labor_templates').insertOne(newTemplate);

        // Log creation
        await db.collection('activity_logs').insertOne({
          _id: new ObjectId(),
          type: 'labor_template_created',
          userId: authUser.userId,
          timestamp: new Date(),
          metadata: {
            templateId: newTemplate._id,
            name: newTemplate.name,
            jurisdiction: newTemplate.jurisdiction
          }
        });

        return res.status(200).json({
          success: true,
          template: newTemplate,
          message: 'Template created successfully'
        });
      }

      case 'PUT': {
        // Update existing template
        const { templateId } = req.query;
        const updates = req.body;

        if (!templateId) {
          return res.status(400).json({ error: 'Template ID required' });
        }

        const user = await db.collection('users').findOne({
          _id: new ObjectId(authUser._id)
        });

        if (!['admin', 'owner'].includes(user?.role)) {
          return res.status(403).json({ error: 'Only admins can update templates' });
        }

        // Create new version instead of updating directly
        const currentTemplate = await db.collection('labor_templates').findOne({
          _id: new ObjectId(templateId as string),
          active: true
        });

        if (!currentTemplate) {
          return res.status(404).json({ error: 'Template not found' });
        }

        // Deactivate current version
        await db.collection('labor_templates').updateOne(
          { _id: new ObjectId(templateId as string) },
          { 
            $set: { 
              active: false,
              deactivatedAt: new Date(),
              deactivatedBy: authUser.userId
            } 
          }
        );

        // Create new version
        const newVersion = {
          ...currentTemplate,
          _id: new ObjectId(),
          ...updates,
          version: (currentTemplate.version || 1) + 1,
          previousVersionId: currentTemplate._id,
          active: true,
          updatedBy: authUser.userId,
          updatedAt: new Date()
        };

        delete newVersion.deactivatedAt;
        delete newVersion.deactivatedBy;

        await db.collection('labor_templates').insertOne(newVersion);

        return res.status(200).json({
          success: true,
          template: newVersion,
          message: 'Template updated successfully'
        });
      }

      case 'DELETE': {
        // Soft delete template
        const { templateId } = req.query;

        if (!templateId) {
          return res.status(400).json({ error: 'Template ID required' });
        }

        const user = await db.collection('users').findOne({
          _id: new ObjectId(authUser._id)
        });

        if (!['admin', 'owner'].includes(user?.role)) {
          return res.status(403).json({ error: 'Only admins can delete templates' });
        }

        const result = await db.collection('labor_templates').updateOne(
          { _id: new ObjectId(templateId as string) },
          { 
            $set: { 
              active: false,
              deletedAt: new Date(),
              deletedBy: authUser.userId
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Template not found' });
        }

        return res.status(200).json({
          success: true,
          message: 'Template deleted successfully'
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

  } catch (error: any) {
    console.error('Labor templates error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

// Example of template structure in MongoDB:
/*
{
  "_id": ObjectId("..."),
  "name": "California Labor Laws 2024",
  "description": "Comprehensive California state labor law requirements effective January 1, 2024",
  "jurisdiction": "US-CA",
  "category": "state",
  "effectiveDate": ISODate("2024-01-01"),
  "expiryDate": null,
  "rules": {
    "overtime": {
      "weeklyThreshold": 40,
      "dailyThreshold": 8,
      "multiplier": 1.5,
      "doubleTimeThreshold": 12,
      "doubleTimeMultiplier": 2.0,
      "calculateDaily": true,
      "seventhDayRule": true,
      "alternativeWorkweek": {
        "allowed": true,
        "maxHoursBeforeOT": 10
      }
    },
    "breaks": {
      "paidBreaks": [
        {
          "afterHours": 3.5,
          "duration": 10,
          "isPaid": true,
          "mandatory": true
        }
      ],
      "mealBreaks": [
        {
          "afterHours": 5,
          "duration": 30,
          "isPaid": false,
          "mandatory": true,
          "penalty": 1,
          "canBeWaived": true,
          "waiverConditions": "If shift is 6 hours or less"
        }
      ]
    },
    "minimumWage": {
      "standard": 16.00,
      "tipped": 16.00,
      "learners": 15.20,
      "effectiveDate": ISODate("2024-01-01"),
      "localVariations": [
        {
          "city": "San Francisco",
          "rate": 18.07
        },
        {
          "city": "Los Angeles",
          "rate": 16.78
        }
      ]
    },
    "holidays": [
      {
        "name": "New Year's Day",
        "date": "01-01",
        "type": "fixed",
        "paid": false,
        "premiumPay": 0
      }
    ]
  },
  "tags": ["california", "state-law", "2024", "wage-order"],
  "metadata": {
    "source": "California DIR",
    "lastReviewedDate": ISODate("2024-01-15"),
    "reviewedBy": "admin123",
    "references": [
      {
        "title": "California Labor Code",
        "url": "https://leginfo.legislature.ca.gov/faces/codes.xhtml",
        "section": "510-558"
      }
    ]
  },
  "isOfficial": true,
  "active": true,
  "version": 2,
  "previousVersionId": ObjectId("...")
}
*/