/**
 * File: auth.ts
 * Purpose: Centralized JWT auth that checks if user exists and not soft-deleted
 * Author: LPai Team
 * Last Modified: 2025-01-28
 * Dependencies: JWT, MongoDB
 */

import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import clientPromise, { getDbName } from './mongodb';

export async function verifyAuth(req: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    throw new Error('No token provided');
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
    
    // Debug log to see token structure
    if (process.env.NODE_ENV === 'development') {
      console.log('Decoded JWT:', {
        _id: decoded._id,
        userId: decoded.userId,
        email: decoded.email
      });
    }
    
    // Get database connection
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Try multiple fields for user ID
    const userId = decoded._id || decoded.userId || decoded.id;
    
    if (!userId) {
      console.error('No user ID found in token. Token structure:', Object.keys(decoded));
      throw new Error('Invalid token - no user ID');
    }
    
    // Convert to ObjectId, handling if it's already an ObjectId string
    let objectId;
    try {
      objectId = new ObjectId(userId);
    } catch (e) {
      console.error('Invalid ObjectId format:', userId);
      throw new Error('Invalid user ID format');
    }
    
    // Find user - be lenient for now to avoid breaking existing users
    const user = await db.collection('users').findOne({
      _id: objectId
    });
    
    if (!user) {
      console.error('User not found for ID:', userId);
      throw new Error('User not found');
    }
    
    // Only check isDeleted if the field exists and is true
    if (user.isDeleted === true) {
      console.error('User is soft-deleted:', userId);
      throw new Error('User account has been deactivated');
    }
    
    // Return decoded token with user data
    return {
      ...decoded,
      currentUser: user
    };
  } catch (error: any) {
    // Log the actual error for debugging
    console.error('Auth verification failed:', {
      message: error.message,
      name: error.name,
      stack: error.stack
    });
    
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    
    // Re-throw our custom errors
    if (error.message === 'User not found' || 
        error.message === 'User account has been deactivated' ||
        error.message === 'Invalid token - no user ID' ||
        error.message === 'Invalid user ID format') {
      throw error;
    }
    
    // Generic error
    throw new Error('Authentication failed');
  }
}
