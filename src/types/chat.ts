import { ObjectId } from 'mongodb';

export interface ChatRoom {
  _id?: ObjectId;
  roomId: string;
  name: string;
  description?: string;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  _id?: ObjectId;
  roomId: string;   
  sender: ObjectId;   
  text: string;
  attachments?: {
    url: string;
    type: "image" | "file" | "video" | "audio";
  }[];
  readBy: string[];
  createdAt: Date;
}

export interface ChatReadStatus {
  _id?: ObjectId;
  userId: string;
  roomId: string;
  messageId: string;
  readAt: Date;
  createdAt: Date;
}

export interface RoomUnreadCount {
  roomId: string;
  unreadCount: number;
  lastMessageAt?: Date;
  lastUnreadMessage?: {
    _id: string;
    text: string;
    sender: string;
    createdAt: Date;
  };
}

export interface UserNotificationSettings {
  _id?: string;
  userId: string;
  pushNotifications: boolean;
  emailNotifications: boolean;
  mentionNotifications: boolean;
  allMessagesNotifications: boolean;
  quietHours?: {
    enabled: boolean;
    startTime: string; // "22:00"
    endTime: string;   // "08:00"
    timezone: string;
  };
  updatedAt: Date;
}

export interface CreateRoomRequest {
  roomId: string;
  name: string;
  description?: string;
}

export interface SendMessageRequest {
  text: string;
  attachments?: {
    url: string;
    type: "image" | "file" | "video" | "audio";
  }[];
}

export interface MessageListQuery {
  page?: string | number;
  limit?: string | number;
  before?: string;
  after?: string;
}

export interface MarkAsReadRequest {
  messageIds?: string[];
  markAllAsRead?: boolean;
  upToMessageId?: string;
}

export interface UnreadCountsResponse {
  totalUnread: number;
  roomUnreadCounts: RoomUnreadCount[];
}

export interface MessageWithSender extends Omit<ChatMessage, 'sender'> {
  sender: {
    _id: string;
    firstName?: string;
    lastName?: string;
    avatar?: string;
  };
  isRead?: boolean;
  readAt?: Date;
} 