/**
 * File: chat.ts
 * Purpose: Team chat API endpoint with mention support
 * Author: LPai Team
 * Last Modified: 2025-10-14
 * Dependencies: MongoDB, Ably, OneSignal
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise, { getDbName } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import Ably from 'ably';
import axios from 'axios';

// Initialize Ably
const ably = new Ably.Rest(process.env.ABLY_API_KEY!);

/**
 * Extract mentions from message text
 * Parses @[userId:Name] format and returns array of userIds
 */
function extractMentions(text: string): string[] {
  const mentionRegex = /@\[([^:]+):[^\]]+\]/g;
  const mentions: string[] = [];
  let match;
  
  while ((match = mentionRegex.exec(text)) !== null) {
    const userId = match[1];
    if (userId && !mentions.includes(userId)) {
      mentions.push(userId);
    }
  }
  
  return mentions;
}

/**
 * Send push notifications to mentioned users
 * 
 * Alternative simpler version (for testing):
 * 
 * async function sendMentionNotifications(
 *   mentions: string[],
 *   messageData: {
 *     senderName: string;
 *     channelName: string;
 *     messageText: string;
 *     locationId: string;
 *   }
 * ) {
 *   if (mentions.length === 0) return;
 *   
 *   console.log('📨 Would send notifications to:', mentions);
 *   console.log('📨 Message:', messageData.messageText);
 *   
 *   // TODO: Implement OneSignal notifications
 *   // For now, just log that we would send notifications
 *   
 *   return;
 * }
 */
/**
 * Send push notifications to mentioned users via OneSignal
 * Uses the same pattern as existing automation notifications
 */
async function sendMentionNotifications(
  mentions: string[],
  messageData: {
    senderName: string;
    channelName: string;
    messageText: string;
    locationId: string;
  }
) {
  if (mentions.length === 0) return;
  
  console.log('📨 Sending mention notifications to:', mentions);
  
  try {
    const client = await clientPromise;
    const db = client.db(getDbName());
    
    // Get users with OneSignal player IDs (using same field as automations)
    const users = await db.collection('users')
      .find({
        $or: [
          { ghlUserId: { $in: mentions } },
          { userId: { $in: mentions } },
          { _id: { $in: mentions.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id)) } }
        ]
      })
      .toArray();
    
    if (users.length === 0) {
      console.log('⚠️ No users found for mentions');
      return;
    }
    
    // Get all player IDs (same pattern as automations)
    const playerIds = users.flatMap(user => 
      user.oneSignalPlayerId ? [user.oneSignalPlayerId] : []
    ).filter(Boolean);
    
    if (playerIds.length === 0) {
      console.log('⚠️ No OneSignal player IDs found');
      return;
    }
    
    console.log(`✅ Found ${playerIds.length} player IDs for ${users.length} users`);
    
    // Clean message text (remove mention formatting)
    const cleanText = messageData.messageText.replace(/@\[([^:]+):([^\]]+)\]/g, '@$2');
    
    // Truncate if too long
    const notificationBody = cleanText.length > 120 
      ? cleanText.substring(0, 120) + '...' 
      : cleanText;
    
    // Build notification title (match existing pattern)
    const isDM = !['General', 'Projects', 'Quotes'].includes(messageData.channelName);
    const title = isDM 
      ? messageData.senderName
      : `${messageData.senderName} in #${messageData.channelName}`;
    
    // Send notification using same format as automations
    const notification = {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_player_ids: playerIds,
      headings: { en: title },
      contents: { en: notificationBody },
      data: {
        type: 'team_mention',
        screen: 'TeamChatScreen',
        locationId: messageData.locationId,
        channelName: messageData.channelName,
        senderName: messageData.senderName
      },
      ios_badgeType: 'Increase',
      ios_badgeCount: 1,
      priority: 10
    };
    
    console.log('📤 Sending OneSignal notification:', JSON.stringify(notification, null, 2));
    
    // Use axios like your existing code
    const response = await axios.post('https://onesignal.com/api/v1/notifications', notification, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
      }
    });
    
    const result = response.data;
    console.log(`✅ OneSignal success:`, result);
    
  } catch (error) {
    console.error('❌ Failed to send mention notifications:', error);
    // Don't throw - notifications are non-critical
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { method } = req;

  try {
    switch (method) {
      case 'GET': {
        const { action, locationId, userId, channelKey } = req.query;

        // Handle token generation
        if (action === 'token') {
          if (!locationId || !userId) {
            return res.status(400).json({
              success: false,
              error: 'Missing locationId or userId'
            });
          }

          // Generate Ably token
          const tokenRequest = await ably.auth.createTokenRequest({
            clientId: userId as string,
            capability: {
              [`chat:*`]: ['publish', 'subscribe', 'presence'],
              [`location:${locationId}`]: ['subscribe'],
            },
          });

          return res.status(200).json({
            success: true,
            token: tokenRequest,
            clientId: userId
          });
        }

        // Handle message fetching
        if (channelKey) {
          if (!locationId) {
            return res.status(400).json({
              success: false,
              error: 'Missing locationId'
            });
          }

          const client = await clientPromise;
          const db = client.db(getDbName());

          // Fetch messages for channel
          const messages = await db
            .collection('team_messages')
            .find({ channelId: channelKey as string })
            .sort({ createdAt: 1 })
            .limit(100)
            .toArray();

          return res.status(200).json({
            success: true,
            messages
          });
        }

        return res.status(400).json({
          success: false,
          error: 'Invalid GET request'
        });
      }

      case 'POST': {
        const {
          text,
          locationId,
          userId,
          userName,
          userEmail,
          channelId,
          isDirect,
          participants
        } = req.body;

        if (!text || !locationId || !userId || !channelId) {
          return res.status(400).json({
            success: false,
            error: 'Missing required fields'
          });
        }

        const client = await clientPromise;
        const db = client.db(getDbName());

        // Extract mentions from message text
        const mentions = extractMentions(text);

        // Create message document
        const message = {
          _id: new ObjectId(),
          channelId,
          userId,
          userName,
          userEmail,
          text,
          mentions, // Add mentions array
          createdAt: new Date(),
          readBy: [userId],
          attachments: [],
          reactions: {},
          edited: false
        };

        // Save to MongoDB
        await db.collection('team_messages').insertOne(message);

        // Get channel name for notifications
        let channelName = 'Team Chat';
        if (!isDirect) {
          // channelId format: "locationId:channelId" (e.g., "5OuaTrizW5wkZMI1xtvX:general")
          const channelIdPart = channelId.includes(':') ? channelId.split(':')[1] : channelId;
          
          const channel = await db.collection('team_channels').findOne({
            id: channelIdPart,
            locationId
          });
          
          // Fallback to default channel names if not found in DB
          if (channel) {
            channelName = channel.name;
          } else {
            // Use the channel ID as a fallback (general, projects, quotes)
            channelName = channelIdPart.charAt(0).toUpperCase() + channelIdPart.slice(1);
          }
        }

        // Publish to Ably
        const ablyChannel = ably.channels.get(`chat:${channelId}:messages`);
        await ablyChannel.publish('message', message);

        // Send push notifications to mentioned users (async, non-blocking)
        if (mentions.length > 0) {
          sendMentionNotifications(mentions, {
            senderName: userName,
            channelName,
            messageText: text,
            locationId
          }).catch(err => console.error('Mention notification error:', err));
        }

        return res.status(200).json({
          success: true,
          message
        });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({
          success: false,
          error: `Method ${method} Not Allowed`
        });
    }
  } catch (error: any) {
    console.error('Error in team chat API:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}