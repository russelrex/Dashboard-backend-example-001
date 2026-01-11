// pages/api/admin/labor-rules.ts
import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '../../../src/lib/mongodb';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';

// Labor rule templates for common states/regions
const RULE_TEMPLATES = {
  'federal-default': {
    ruleName: 'Federal Default',
    rules: {
      overtime: {
        weeklyThreshold: 40,
        dailyThreshold: null,
        multiplier: 1.5,
        doubleTimeThreshold: null,
        doubleTimeMultiplier: 2.0,
        calculateDaily: false
      },
      breaks: {
        paidBreaks: [],
        mealBreaks: [{
          afterHours: 6,
          duration: 30,
          isPaid: false,
          mandatory: false
        }]
      },
      mileage: {
        reimbursementRate: 0.67, // 2024 IRS rate
        requiresReceipts: false,
        categories: [{
          type: 'business',
          rate: 0.67,
          taxable: false
        }]
      },
      minimumWage: {
        standard: 7.25,
        tipped: 2.13,
        training: 7.25,
        effectiveDate: new Date('2009-07-24')
      },
      scheduling: {
        minimumShiftLength: 0,
        splitShiftPremium: 0,
        callInPay: 0,
        advanceNoticeRequired: 0
      },
      pto: {
        accrualRate: 0,
        maxAccrual: 0,
        carryOver: false,
        payoutOnTermination: false
      }
    }
  },
  'california': {
    ruleName: 'California Labor Laws',
    rules: {
      overtime: {
        weeklyThreshold: 40,
        dailyThreshold: 8,
        multiplier: 1.5,
        doubleTimeThreshold: 12,
        doubleTimeMultiplier: 2.0,
        calculateDaily: true,
        seventhDayRule: true // OT for first 8 hours on 7th consecutive day
      },
      breaks: {
        paidBreaks: [
          {
            afterHours: 3.5,
            duration: 10,
            isPaid: true,
            mandatory: true
          },
          {
            afterHours: 6,
            duration: 10,
            isPaid: true,
            mandatory: true
          }
        ],
        mealBreaks: [
          {
            afterHours: 5,
            duration: 30,
            isPaid: false,
            mandatory: true,
            penalty: 1 // 1 hour penalty if not provided
          },
          {
            afterHours: 10,
            duration: 30,
            isPaid: false,
            mandatory: true,
            penalty: 1
          }
        ]
      },
      mileage: {
        reimbursementRate: 0.67,
        requiresReceipts: false,
        categories: [{
          type: 'business',
          rate: 0.67,
          taxable: false
        }]
      },
      minimumWage: {
        standard: 16.00,
        tipped: 16.00, // CA doesn't have tipped minimum
        training: 16.00,
        effectiveDate: new Date('2024-01-01')
      },
      scheduling: {
        minimumShiftLength: 2,
        splitShiftPremium: 16.00, // One hour at minimum wage
        callInPay: 2, // Minimum 2 hours
        advanceNoticeRequired: 0,
        reportingTimePay: 2 // Minimum 2 hours if sent home early
      },
      pto: {
        accrualRate: 0.0333, // 1 hour per 30 worked (CA min)
        maxAccrual: 48, // Can cap at 48 hours
        carryOver: true,
        payoutOnTermination: true // Required in CA
      }
    }
  },
  'new-york': {
    ruleName: 'New York Labor Laws',
    rules: {
      overtime: {
        weeklyThreshold: 40,
        dailyThreshold: null,
        multiplier: 1.5,
        doubleTimeThreshold: null,
        doubleTimeMultiplier: 2.0,
        calculateDaily: false,
        spreadOfHours: 10 // Extra hour if day > 10 hours
      },
      breaks: {
        paidBreaks: [],
        mealBreaks: [{
          afterHours: 6,
          duration: 30,
          isPaid: false,
          mandatory: true
        }]
      },
      mileage: {
        reimbursementRate: 0.67,
        requiresReceipts: false,
        categories: [{
          type: 'business',
          rate: 0.67,
          taxable: false
        }]
      },
      minimumWage: {
        standard: 15.00, // NYC rate
        tipped: 10.00,
        training: 15.00,
        effectiveDate: new Date('2024-01-01')
      },
      scheduling: {
        minimumShiftLength: 4,
        splitShiftPremium: 0,
        callInPay: 4,
        advanceNoticeRequired: 0
      },
      pto: {
        accrualRate: 0.0192, // 1 hour per 52 worked
        maxAccrual: 40,
        carryOver: true,
        payoutOnTermination: false
      }
    }
  }
};

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
        const { locationId, template, activeOnly = 'true' } = req.query;

        // Return template if requested
        if (template) {
          const templateData = RULE_TEMPLATES[template as string];
          if (!templateData) {
            return res.status(404).json({ error: 'Template not found' });
          }
          return res.status(200).json({
            template: templateData,
            availableTemplates: Object.keys(RULE_TEMPLATES)
          });
        }

        // Get rules for a location
        if (!locationId) {
          return res.status(400).json({ error: 'Location ID required' });
        }

        // Check if user has access to this location
        const user = await db.collection('users').findOne({
          _id: new ObjectId(authUser._id)
        });

        if (!['admin', 'owner', 'manager'].includes(user?.role)) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }

        // Get active rules
        let query: any = { locationId: locationId as string };
        
        if (activeOnly === 'true') {
          query.effectiveDate = { $lte: new Date() };
          query.$or = [
            { expiryDate: { $gte: new Date() } },
            { expiryDate: null }
          ];
        }

        const rules = await db.collection('labor_rules')
          .find(query)
          .sort({ effectiveDate: -1 })
          .limit(activeOnly === 'true' ? 1 : 10)
          .toArray();

        if (rules.length === 0 && activeOnly === 'true') {
          // Return default rules if none found
          return res.status(200).json({
            ...RULE_TEMPLATES['federal-default'],
            _id: null,
            locationId: locationId,
            isDefault: true,
            effectiveDate: new Date(),
            expiryDate: null
          });
        }

        return res.status(200).json(
          activeOnly === 'true' ? rules[0] : { rules, total: rules.length }
        );
      }

      case 'POST': {
        // Create or update labor rules
        const { 
          locationId, 
          ruleName,
          rules,
          template,
          effectiveDate,
          notes 
        } = req.body;

        if (!locationId) {
          return res.status(400).json({ error: 'Location ID required' });
        }

        // Check permissions
        const user = await db.collection('users').findOne({
          _id: new ObjectId(authUser._id)
        });

        if (!['admin', 'owner'].includes(user?.role)) {
          return res.status(403).json({ error: 'Only admins and owners can modify labor rules' });
        }

        // Start with template if provided
        let ruleData = template ? RULE_TEMPLATES[template] : null;
        
        if (!ruleData && !rules) {
          return res.status(400).json({ error: 'Either template or rules must be provided' });
        }

        // Merge with custom rules if provided
        if (rules) {
          ruleData = {
            ruleName: ruleName || ruleData?.ruleName || 'Custom Rules',
            rules: {
              ...ruleData?.rules,
              ...rules
            }
          };
        }

        // Validate required fields
        if (!ruleData.rules.overtime || !ruleData.rules.mileage) {
          return res.status(400).json({ error: 'Overtime and mileage rules are required' });
        }

        // Expire current active rules
        await db.collection('labor_rules').updateMany(
          { 
            locationId,
            expiryDate: null 
          },
          { 
            $set: { 
              expiryDate: new Date(),
              expiredBy: authUser.userId,
              expiredAt: new Date()
            } 
          }
        );

        // Create new rules
        const newRules = {
          _id: new ObjectId(),
          locationId,
          ...ruleData,
          effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
          expiryDate: null,
          createdBy: authUser.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          notes: notes || null,
          version: await getNextVersion(db, locationId)
        };

        await db.collection('labor_rules').insertOne(newRules);

        // Log the change
        await db.collection('activity_logs').insertOne({
          _id: new ObjectId(),
          type: 'labor_rules_updated',
          userId: authUser.userId,
          locationId,
          timestamp: new Date(),
          metadata: {
            ruleId: newRules._id,
            ruleName: newRules.ruleName,
            template: template || 'custom',
            notes
          }
        });

        return res.status(200).json({
          success: true,
          rules: newRules,
          message: 'Labor rules updated successfully'
        });
      }

      case 'PUT': {
        // Update specific rule fields
        const { ruleId } = req.query;
        const updates = req.body;

        if (!ruleId) {
          return res.status(400).json({ error: 'Rule ID required' });
        }

        // Check permissions
        const user = await db.collection('users').findOne({
          _id: new ObjectId(authUser._id)
        });

        if (!['admin', 'owner'].includes(user?.role)) {
          return res.status(403).json({ error: 'Only admins and owners can modify labor rules' });
        }

        // Update the rule
        const result = await db.collection('labor_rules').findOneAndUpdate(
          { 
            _id: new ObjectId(ruleId as string),
            expiryDate: null // Only update active rules
          },
          { 
            $set: {
              ...updates,
              updatedAt: new Date(),
              updatedBy: authUser.userId
            }
          },
          { returnDocument: 'after' }
        );

        if (!result.value) {
          return res.status(404).json({ error: 'Active rule not found' });
        }

        return res.status(200).json({
          success: true,
          rules: result.value
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

  } catch (error: any) {
    console.error('Labor rules error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

async function getNextVersion(db: any, locationId: string): Promise<number> {
  const lastRule = await db.collection('labor_rules')
    .findOne(
      { locationId },
      { sort: { version: -1 }, projection: { version: 1 } }
    );
  
  return (lastRule?.version || 0) + 1;
}