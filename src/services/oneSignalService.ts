// lpai-backend/src/services/oneSignalService.ts
import axios from 'axios';

interface NotificationData {
  headings: { en: string };
  contents: { en: string };
  data?: any;
  ios_badgeType?: string;
  ios_badgeCount?: number;
  android_channel_id?: string;
  priority?: number;
}

class OneSignalService {
  private appId: string;
  private apiKey: string;
  private apiUrl: string = 'https://onesignal.com/api/v1';

  constructor() {
    this.appId = process.env.ONESIGNAL_APP_ID || '';
    this.apiKey = process.env.ONESIGNAL_REST_API_KEY || '';
    
    if (!this.appId || !this.apiKey) {
      console.warn('⚠️ OneSignal not configured - push notifications disabled');
    }
  }

  /**
   * Send notification to specific users
   */
  async sendToUsers(userIds: string | string[], notification: NotificationData): Promise<any> {
    if (!this.appId || !this.apiKey) {
      console.log('OneSignal not configured, skipping notification');
      return null;
    }

    // ✅ FIX: Add message content validation
    let messageContent = notification.contents?.en || '';
    let heading = notification.headings?.en || '';
    
    // Validate and provide fallbacks for empty content
    if (!messageContent || messageContent.trim() === '') {
      messageContent = 'New notification';
      console.warn('⚠️ OneSignal: Empty message content, using fallback');
    }
    
    if (!heading || heading.trim() === '') {
      heading = 'LPai';
      console.warn('⚠️ OneSignal: Empty heading, using fallback');
    }

    try {
      const payload = {
        app_id: this.appId,
        include_external_user_ids: Array.isArray(userIds) ? userIds : [userIds],
        contents: { en: messageContent },
        headings: { en: heading },
        data: notification.data,
        
        // ✅ iOS Styling
        ios_badgeType: notification.ios_badgeType || 'Increase',
        ios_badgeCount: notification.ios_badgeCount || 1,
        ios_sound: 'default',
        
        // ✅ Android Styling - THIS IS THE MAGIC!
        android_accent_color: 'FF4A90E2',  // Blue like your clock-out notification
        android_channel_id: 'fieldservai-appointments',
        small_icon: 'ic_stat_onesignal_default',
        large_icon: 'ic_large_icon',  // Your app icon
        android_sound: 'default',
        android_visibility: 1,  // Show on lock screen
        
        // ✅ Priority
        priority: notification.priority || 10,
        
        // ✅ Rich Content (optional - for images)
        ...(notification.big_picture && { big_picture: notification.big_picture }),
      };

      const response = await axios.post(
        `${this.apiUrl}/notifications`,
        payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${this.apiKey}`
          }
        }
      );

      console.log('✅ Push notification sent to users:', userIds);
      return response.data;
    } catch (error: any) {
      console.error('❌ OneSignal error:', error.response?.data || error.message);
      // Don't throw - we don't want to break the flow if push fails
      return null;
    }
  }

  /**
   * Send appointment notification
   */
  async sendAppointmentNotification(
    userId: string,
    appointment: any,
    type: 'created' | 'reminder' | 'cancelled'
  ): Promise<any> {
    const titles = {
      created: '📅 New Appointment',
      reminder: '⏰ Appointment Reminder',
      cancelled: '❌ Appointment Cancelled'
    };

    const time = new Date(appointment.start).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });

    return this.sendToUsers(userId, {
      headings: { en: titles[type] },
      contents: { en: `${appointment.title} at ${time}` },
      data: {
        type: 'appointment',
        appointmentId: appointment._id?.toString() || appointment.id,
        action: 'view_appointment',
        screen: 'AppointmentDetailScreen'
      },
      // ✅ ADD STYLING
      android_accent_color: 'FF4A90E2',
      android_channel_id: 'fieldservai-appointments',
      large_icon: 'ic_large_icon',
      priority: 10
    });
  }

  /**
   * Send quote notification
   */
  async sendQuoteNotification(
    userId: string,
    quote: any,
    type: 'published' | 'signed' | 'viewed' | 'expired'
  ): Promise<any> {
    const titles = {
      published: '📄 New Quote Available',
      signed: '✅ Quote Signed!',
      viewed: '👁️ Quote Viewed',
      expired: '⏰ Quote Expired'
    };

    return this.sendToUsers(userId, {
      headings: { en: titles[type] },
      contents: { en: `Quote #${quote.quoteNumber} - ${quote.title || 'View Details'}` },
      data: {
        type: 'quote',
        quoteId: quote._id?.toString(),
        status: type,
        action: 'view_quote'
      }
    });
  }

  /**
   * Send payment notification
   */
  async sendPaymentNotification(
    userId: string,
    payment: any
  ): Promise<any> {
    const amount = typeof payment.amount === 'number' 
      ? (payment.amount / 100).toFixed(2) 
      : payment.amount;

    return this.sendToUsers(userId, {
      headings: { en: '💰 Payment Received!' },
      contents: { en: `$${amount} from ${payment.customerName || 'Customer'}` },
      data: {
        type: 'payment',
        paymentId: payment._id?.toString() || payment.id,
        invoiceId: payment.invoiceId,
        action: 'view_payment'
      }
    });
  }

  /**
   * Send message notification
   */
  async sendMessageNotification(
    userId: string,
    message: any,
    contact: any
  ): Promise<any> {
    const messageText = message.body?.length > 50 
      ? message.body.substring(0, 47) + '...' 
      : message.body;

    return this.sendToUsers(userId, {
      headings: { en: `💬 ${contact.name || 'New Message'}` },
      contents: { en: messageText || 'You have a new message' },
      data: {
        type: 'message',
        messageId: message._id?.toString(),
        conversationId: message.conversationId,
        contactId: contact._id?.toString(),
        action: 'open_conversation'
      }
    });
  }

  /**
   * Send team notification
   */
  async sendTeamNotification(
    userIds: string[],
    notification: {
      title: string;
      message: string;
      data?: any;
    }
  ): Promise<any> {
    // ✅ FIX: Validate team notification content
    let title = notification.title || '';
    let message = notification.message || '';
    
    // Validate and provide fallbacks for empty content
    if (!title || title.trim() === '') {
      title = 'LPai Team';
      console.warn('⚠️ OneSignal Team: Empty title, using fallback');
    }
    
    if (!message || message.trim() === '') {
      message = 'You have a new team notification';
      console.warn('⚠️ OneSignal Team: Empty message, using fallback');
    }
    
    return this.sendToUsers(userIds, {
      headings: { en: title },
      contents: { en: message },
      data: notification.data,
      android_channel_id: 'fieldservai-team'
    });
  }

  /**
   * Send team notification for clock in
   */
  async notifyTeamClockIn(
    locationId: string,
    userName: string,
    excludeUserId: string
  ): Promise<any> {
    // For now, just log - we need to get team members from DB
    console.log('Team clock in notification:', { locationId, userName, excludeUserId });
    return null;
  }

  /**
   * Send team notification for clock out
   */
  async notifyTeamClockOut(
    locationId: string,
    userName: string,
    totalMiles: number,
    excludeUserId: string
  ): Promise<any> {
    // For now, just log - we need to get team members from DB
    console.log('Team clock out notification:', { locationId, userName, totalMiles, excludeUserId });
    return null;
  }

  /**
   * Send automation notification
   */
  async sendAutomationNotification(
    userId: string,
    notification: any
  ): Promise<any> {
    if (!this.appId || !this.apiKey) {
      console.log('OneSignal not configured, skipping automation notification');
      return null;
    }

    // Handle the automation push notification format
    const template = notification.template || notification;
    
    // ✅ FIX: Validate automation notification content
    let title = template.title || '';
    let body = template.body || '';
    
    // Validate and provide fallbacks for empty content
    if (!title || title.trim() === '') {
      title = 'LPai Automation';
      console.warn('⚠️ OneSignal Automation: Empty title, using fallback');
    }
    
    if (!body || body.trim() === '') {
      body = 'You have a new notification';
      console.warn('⚠️ OneSignal Automation: Empty body, using fallback');
    }
    
    return this.sendToUsers(userId, {
      headings: { en: title },
      contents: { en: body },
      data: template.data || {},
      ios_badgeType: 'Increase',
      ios_badgeCount: 1,
      priority: template.priority || 10
    });
  }
}

// Export singleton instance
export const oneSignalService = new OneSignalService();