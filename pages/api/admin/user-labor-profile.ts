// pages/api/admin/user-labor-profile.ts
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

    // Check permissions
    const requestingUser = await db.collection('users').findOne({
      _id: new ObjectId(authUser._id)
    });

    if (!['admin', 'owner', 'manager'].includes(requestingUser?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    switch (req.method) {
      case 'GET': {
        const { userId, locationId } = req.query;

        if (!userId) {
          // Get all user profiles for a location
          if (!locationId) {
            return res.status(400).json({ error: 'User ID or Location ID required' });
          }

          const profiles = await db.collection('user_labor_profiles')
            .aggregate([
              {
                $match: {
                  locationId: locationId as string,
                  active: true
                }
              },
              {
                $lookup: {
                  from: 'users',
                  localField: 'userId',
                  foreignField: '_id',
                  as: 'user'
                }
              },
              {
                $unwind: '$user'
              },
              {
                $project: {
                  userId: 1,
                  userName: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
                  email: '$user.email',
                  role: '$user.role',
                  profile: 1,
                  exceptions: 1,
                  effectiveDate: 1,
                  createdAt: 1
                }
              }
            ])
            .toArray();

          return res.status(200).json({ profiles });
        }

        // Get specific user profile
        const profile = await db.collection('user_labor_profiles').findOne({
          userId: userId as string,
          active: true
        });

        if (!profile) {
          // Return default profile
          return res.status(200).json({
            userId: userId,
            profile: {
              useLocationDefaults: true,
              customRates: {},
              exceptions: []
            }
          });
        }

        return res.status(200).json(profile);
      }

      case 'POST': {
        // Create or update user labor profile
        const { 
          userId, 
          locationId,
          profile,
          effectiveDate
        } = req.body;

        if (!userId || !locationId || !profile) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate user exists
        const user = await db.collection('users').findOne({
          ghlUserId: userId,
          locationId: locationId
        });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Deactivate existing profile
        await db.collection('user_labor_profiles').updateMany(
          { userId, active: true },
          { 
            $set: { 
              active: false,
              deactivatedAt: new Date(),
              deactivatedBy: authUser.userId
            } 
          }
        );

        // Create new profile
        const newProfile = {
          _id: new ObjectId(),
          userId,
          locationId,
          profile: {
            // Custom hourly rate
            hourlyRate: profile.hourlyRate || user.hourlyRate,
            
            // Overtime exemption status
            overtimeExempt: profile.overtimeExempt || false,
            
            // Custom overtime rules
            customOvertimeRules: profile.customOvertimeRules || null,
            
            // Mileage rate override
            mileageRate: profile.mileageRate || null,
            
            // Break exemptions
            breakExemptions: profile.breakExemptions || [],
            
            // Minimum guaranteed hours
            guaranteedHours: profile.guaranteedHours || null,
            
            // Shift differentials
            shiftDifferentials: profile.shiftDifferentials || [],
            
            // PTO settings
            ptoSettings: profile.ptoSettings || null,
            
            // Department/job codes for cost allocation
            defaultDepartment: profile.defaultDepartment || null,
            defaultJobCode: profile.defaultJobCode || null,
            
            // Pay frequency override
            payFrequency: profile.payFrequency || 'biweekly',
            
            // Tax exemptions
            taxExemptions: profile.taxExemptions || {
              federal: 0,
              state: 0
            }
          },
          
          // Date-based exceptions (holidays, special rates, etc.)
          exceptions: profile.exceptions || [],
          
          effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
          active: true,
          createdBy: authUser.userId,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await db.collection('user_labor_profiles').insertOne(newProfile);

        // Update user record with profile reference
        await db.collection('users').updateOne(
          { _id: user._id },  // Use the user._id from the user found above
          { 
            $set: { 
              laborProfileId: newProfile._id,
              hourlyRate: newProfile.profile.hourlyRate,
              overtimeExempt: newProfile.profile.overtimeExempt,
              updatedAt: new Date()
            } 
          }
        );

        // Log the change
        await db.collection('activity_logs').insertOne({
          _id: new ObjectId(),
          type: 'user_labor_profile_updated',
          userId: authUser.userId,
          targetUserId: userId,
          locationId,
          timestamp: new Date(),
          metadata: {
            profileId: newProfile._id,
            changes: {
              hourlyRate: newProfile.profile.hourlyRate,
              overtimeExempt: newProfile.profile.overtimeExempt
            }
          }
        });

        return res.status(200).json({
          success: true,
          profile: newProfile,
          message: 'User labor profile updated successfully'
        });
      }

      case 'PUT': {
        // Add exception or temporary override
        const { userId } = req.query;
        const { exception } = req.body;

        if (!userId || !exception) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        // Validate exception
        if (!exception.startDate || !exception.endDate || !exception.type) {
          return res.status(400).json({ error: 'Invalid exception format' });
        }

        const exceptionData = {
          _id: new ObjectId(),
          type: exception.type, // 'holiday', 'temporary_rate', 'unpaid_leave', etc.
          startDate: new Date(exception.startDate),
          endDate: new Date(exception.endDate),
          details: exception.details || {},
          reason: exception.reason,
          approvedBy: authUser.userId,
          createdAt: new Date()
        };

        const result = await db.collection('user_labor_profiles').updateOne(
          { userId: userId as string, active: true },
          { 
            $push: { exceptions: exceptionData },
            $set: { updatedAt: new Date() }
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Active profile not found' });
        }

        return res.status(200).json({
          success: true,
          exception: exceptionData,
          message: 'Exception added successfully'
        });
      }

      case 'DELETE': {
        // Remove exception
        const { userId, exceptionId } = req.query;

        if (!userId || !exceptionId) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await db.collection('user_labor_profiles').updateOne(
          { userId: userId as string, active: true },
          { 
            $pull: { exceptions: { _id: new ObjectId(exceptionId as string) } },
            $set: { updatedAt: new Date() }
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ error: 'Profile or exception not found' });
        }

        return res.status(200).json({
          success: true,
          message: 'Exception removed successfully'
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

  } catch (error: any) {
    console.error('User labor profile error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
}

// Example of how profile exceptions work:
const exampleExceptions = [
  {
    type: 'holiday',
    startDate: new Date('2024-12-25'),
    endDate: new Date('2024-12-25'),
    details: {
      multiplier: 2.0, // Double time for holiday
      name: 'Christmas'
    },
    reason: 'Federal Holiday'
  },
  {
    type: 'temporary_rate',
    startDate: new Date('2024-06-01'),
    endDate: new Date('2024-08-31'),
    details: {
      hourlyRate: 25.00, // Summer rate increase
      reason: 'Seasonal adjustment'
    },
    reason: 'Summer peak season rate'
  },
  {
    type: 'unpaid_leave',
    startDate: new Date('2024-07-15'),
    endDate: new Date('2024-07-19'),
    details: {
      leaveType: 'personal'
    },
    reason: 'Personal leave request'
  }
];