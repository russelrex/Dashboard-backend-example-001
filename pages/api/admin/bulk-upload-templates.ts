// pages/api/admin/bulk-upload-templates.ts
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

    // Only super admins can bulk upload
    const user = await db.collection('users').findOne({
      _id: new ObjectId(authUser._id)
    });

    if (user?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can bulk upload templates' });
    }

    const { 
      templates,
      mode = 'merge', // 'merge', 'replace', 'skip'
      dryRun = false
    } = req.body;

    if (!templates || !Array.isArray(templates)) {
      return res.status(400).json({ error: 'Templates array required' });
    }

    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [] as any[]
    };

    // Process each template
    for (const templateData of templates) {
      try {
        // Validate template structure
        if (!templateData.name || !templateData.jurisdiction || !templateData.rules) {
          results.errors.push({
            template: templateData.name || 'Unknown',
            error: 'Missing required fields'
          });
          continue;
        }

        // Check if template exists
        const existing = await db.collection('labor_templates').findOne({
          name: templateData.name,
          jurisdiction: templateData.jurisdiction,
          active: true
        });

        if (existing) {
          if (mode === 'skip') {
            results.skipped++;
            continue;
          } else if (mode === 'replace' || mode === 'merge') {
            if (!dryRun) {
              // Deactivate existing
              await db.collection('labor_templates').updateOne(
                { _id: existing._id },
                { 
                  $set: { 
                    active: false,
                    replacedAt: new Date(),
                    replacedBy: authUser.userId
                  } 
                }
              );

              // Create new version
              const newTemplate = {
                _id: new ObjectId(),
                ...templateData,
                version: (existing.version || 1) + 1,
                previousVersionId: existing._id,
                active: true,
                createdBy: authUser.userId,
                createdAt: new Date(),
                updatedAt: new Date(),
                bulkUpload: true,
                bulkUploadBatch: new Date().toISOString()
              };

              await db.collection('labor_templates').insertOne(newTemplate);
              results.updated++;
            } else {
              results.updated++;
            }
          }
        } else {
          // Create new template
          if (!dryRun) {
            const newTemplate = {
              _id: new ObjectId(),
              ...templateData,
              version: 1,
              active: true,
              createdBy: authUser.userId,
              createdAt: new Date(),
              updatedAt: new Date(),
              bulkUpload: true,
              bulkUploadBatch: new Date().toISOString()
            };

            await db.collection('labor_templates').insertOne(newTemplate);
            results.created++;
          } else {
            results.created++;
          }
        }

        results.processed++;

      } catch (error: any) {
        results.errors.push({
          template: templateData.name,
          error: error.message
        });
      }
    }

    // Log bulk upload
    if (!dryRun) {
      await db.collection('activity_logs').insertOne({
        _id: new ObjectId(),
        type: 'bulk_template_upload',
        userId: authUser.userId,
        timestamp: new Date(),
        metadata: {
          mode,
          results,
          totalTemplates: templates.length
        }
      });
    }

    return res.status(200).json({
      success: true,
      dryRun,
      results,
      message: dryRun 
        ? 'Dry run completed - no changes made' 
        : 'Templates uploaded successfully'
    });

  } catch (error: any) {
    console.error('Bulk upload error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

// Example bulk upload format:
/*
POST /api/admin/bulk-upload-templates
{
  "mode": "merge",
  "dryRun": false,
  "templates": [
    {
      "name": "Alabama Labor Laws 2024",
      "description": "Alabama state labor law requirements",
      "jurisdiction": "US-AL",
      "category": "state",
      "effectiveDate": "2024-01-01",
      "rules": {
        "overtime": {
          "weeklyThreshold": 40,
          "dailyThreshold": null,
          "multiplier": 1.5
        },
        "breaks": {
          "paidBreaks": [],
          "mealBreaks": []
        },
        "minimumWage": {
          "standard": 7.25,
          "tipped": 2.13
        },
        "mileage": {
          "reimbursementRate": 0.67
        }
      },
      "tags": ["alabama", "state-law", "2024"]
    },
    {
      "name": "Alaska Labor Laws 2024",
      "description": "Alaska state labor law requirements",
      "jurisdiction": "US-AK",
      "category": "state",
      "effectiveDate": "2024-01-01",
      "rules": {
        "overtime": {
          "weeklyThreshold": 40,
          "dailyThreshold": 8,
          "multiplier": 1.5
        },
        "breaks": {
          "paidBreaks": [],
          "mealBreaks": [
            {
              "afterHours": 5,
              "duration": 30,
              "isPaid": false,
              "mandatory": false
            }
          ]
        },
        "minimumWage": {
          "standard": 11.73,
          "tipped": 11.73
        },
        "mileage": {
          "reimbursementRate": 0.67
        }
      },
      "tags": ["alaska", "state-law", "2024"]
    }
  ]
}
*/