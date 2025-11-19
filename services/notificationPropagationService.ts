/**
 * Notification Propagation Service
 * Handles propagation of rerouting decisions to all affected stakeholders
 * Ensures consistent updates across supplier, receiver, and manager views
 */

import { RerouteEvent, rerouteEventBus } from './rerouteEventBus';
import { UserRole } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface StakeholderNotification {
  trackingNumber: string;
  role: UserRole;
  recipientStopId?: string;
  notification: {
    type: 'ETA_UPDATE' | 'REROUTE' | 'SEQUENCE_CHANGE' | 'DELIVERY_STATUS';
    title: string;
    message: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    oldETA?: number;
    newETA?: number;
    oldPosition?: number;
    newPosition?: number;
    routeChange?: {
      reason: string;
      oldRouteId: string;
      newRouteId: string;
    };
  };
  timestamp: Date;
}

export interface SupplierUpdate {
  shipmentId: string;
  trackingNumber: string;
  updates: {
    newETA: number;
    routeSummary?: string;
    rerouteReason?: string;
    affectedStops: string[];
  };
}

export interface ReceiverUpdate {
  shipmentId: string;
  trackingNumber: string;
  recipientStopId: string;
  updates: {
    newETA: number;
    oldPosition?: number;
    newPosition?: number;
    totalStops: number;
    optimizationMessage?: string;
  };
}

export interface NotificationChannel {
  type: 'IN_APP' | 'EMAIL' | 'SMS' | 'WEBHOOK';
  endpoint?: string;
  enabled: boolean;
}

export interface NotificationPreferences {
  trackingNumber: string;
  channels: NotificationChannel[];
  receiveRerouteAlerts: boolean;
  receiveETAUpdates: boolean;
  receiveSequenceChanges: boolean;
}

// ============================================================================
// NOTIFICATION PROPAGATION SERVICE
// ============================================================================

class NotificationPropagationService {
  private notificationQueue: StakeholderNotification[] = [];
  private preferences: Map<string, NotificationPreferences> = new Map();
  private deliveryCallbacks: Map<string, ((notification: StakeholderNotification) => void)[]> = new Map();

  constructor() {
    // Subscribe to reroute events from the event bus
    this.initializeEventListeners();
  }

  /**
   * Initialize event listeners for reroute events
   */
  private initializeEventListeners(): void {
    rerouteEventBus.subscribe('*', async (event: RerouteEvent) => {
      console.log(`📢 Propagating reroute event: ${event.eventId}`);
      await this.propagateRerouteEvent(event);
    });
  }

  /**
   * Main propagation logic - distributes updates to all stakeholders
   */
  private async propagateRerouteEvent(event: RerouteEvent): Promise<void> {
    try {
      // 1. Fetch all affected tracking numbers for this shipment
      const affectedTrackingNumbers = await this.getAffectedTrackingNumbers(event.shipmentId);

      // 2. Generate role-specific notifications
      const notifications: StakeholderNotification[] = [];

      for (const trackingInfo of affectedTrackingNumbers) {
        const notification = this.generateRoleSpecificNotification(event, trackingInfo);
        if (notification) {
          notifications.push(notification);
        }
      }

      // 3. Deliver notifications through appropriate channels
      for (const notification of notifications) {
        await this.deliverNotification(notification);
      }

      // 4. Log propagation success
      console.log(`✅ Propagated ${notifications.length} notifications for event ${event.eventId}`);
    } catch (error) {
      console.error(`❌ Failed to propagate event ${event.eventId}:`, error);
    }
  }

  /**
   * Fetch all tracking numbers associated with a shipment
   */
  private async getAffectedTrackingNumbers(shipmentId: string): Promise<Array<{
    trackingNumber: string;
    role: UserRole;
    recipientStopId?: string;
  }>> {
    // TODO: Replace with actual database query
    // For now, simulate database fetch
    
    // Example query (PostgreSQL):
    // SELECT tracking_number, role, recipient_stop_id 
    // FROM tracking_numbers 
    // WHERE shipment_id = $1 AND is_active = true

    // Simulated data
    return [
      { trackingNumber: 'SUPP-123', role: UserRole.SUPPLIER },
      { trackingNumber: 'RECV-456', role: UserRole.RECIPIENT, recipientStopId: 'stop-3' },
      { trackingNumber: 'RECV-789', role: UserRole.RECIPIENT, recipientStopId: 'stop-5' },
      { trackingNumber: 'MGR-001', role: UserRole.MANAGER },
    ];
  }

  /**
   * Generate role-specific notification content
   */
  private generateRoleSpecificNotification(
    event: RerouteEvent,
    trackingInfo: { trackingNumber: string; role: UserRole; recipientStopId?: string }
  ): StakeholderNotification | null {
    const { trackingNumber, role, recipientStopId } = trackingInfo;
    const { eventType, changes } = event;

    switch (role) {
      case 'SUPPLIER':
        return this.generateSupplierNotification(event, trackingNumber);

      case 'RECIPIENT':
        return this.generateReceiverNotification(event, trackingNumber, recipientStopId);

      case 'MANAGER':
        return this.generateManagerNotification(event, trackingNumber);

      default:
        return null;
    }
  }

  /**
   * Generate supplier-specific notification
   */
  private generateSupplierNotification(
    event: RerouteEvent,
    trackingNumber: string
  ): StakeholderNotification {
    const { changes, eventType } = event;
    const affectedStopsCount = changes.affectedStops.length;

    let title = '';
    let message = '';
    let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

    switch (eventType) {
      case 'LONG_HAUL_REROUTE':
        title = '🚛 Long-Haul Route Changed';
        message = `Route updated: ${changes.reason}. ${affectedStopsCount} stops affected.`;
        priority = 'HIGH';
        break;

      case 'LAST_MILE_RESEQUENCE':
        title = '📦 Delivery Sequence Optimized';
        message = `Last-mile delivery order adjusted to improve efficiency. ${affectedStopsCount} stops resequenced.`;
        priority = 'MEDIUM';
        break;

      case 'ROUTE_SWITCH':
        title = '🔄 Alternative Route Selected';
        message = `Route switched from ${changes.routeChange?.oldRouteId} to ${changes.routeChange?.newRouteId}. Reason: ${changes.reason}`;
        priority = 'HIGH';
        break;
    }

    // Calculate new ETA for final destination
    const newETAs = Object.values(changes.newETAs);
    const finalETA = Math.max(...newETAs);
    const oldETAs = Object.values(changes.oldETAs);
    const oldFinalETA = Math.max(...oldETAs);

    return {
      trackingNumber,
      role: UserRole.SUPPLIER,
      notification: {
        type: 'REROUTE',
        title,
        message,
        priority,
        oldETA: oldFinalETA,
        newETA: finalETA,
        routeChange: changes.routeChange ? {
          reason: changes.reason,
          oldRouteId: changes.routeChange.oldRouteId,
          newRouteId: changes.routeChange.newRouteId,
        } : undefined,
      },
      timestamp: event.timestamp,
    };
  }

  /**
   * Generate receiver-specific notification
   */
  private generateReceiverNotification(
    event: RerouteEvent,
    trackingNumber: string,
    recipientStopId?: string
  ): StakeholderNotification {
    const { changes, eventType } = event;

    if (!recipientStopId) {
      console.warn(`No recipient stop ID for tracking number ${trackingNumber}`);
      return null as any;
    }

    const oldETA = changes.oldETAs[recipientStopId];
    const newETA = changes.newETAs[recipientStopId];

    // Determine if this stop's sequence changed
    const oldPosition = this.getStopPosition(recipientStopId, event.shipmentId, 'old');
    const newPosition = this.getStopPosition(recipientStopId, event.shipmentId, 'new');

    let title = '';
    let message = '';
    let priority: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';

    if (eventType === 'LAST_MILE_RESEQUENCE' && oldPosition !== newPosition) {
      title = '📍 Delivery Position Updated';
      message = `Your delivery position changed from stop ${oldPosition} to stop ${newPosition} due to route optimization.`;
      priority = 'MEDIUM';
    } else {
      title = '⏰ Delivery Time Updated';
      const etaDiff = Math.abs(newETA - oldETA);
      const earlier = newETA < oldETA;
      message = `Your delivery is now expected ${etaDiff} minutes ${earlier ? 'earlier' : 'later'} due to ${changes.reason.toLowerCase()}.`;
      priority = etaDiff > 30 ? 'HIGH' : 'MEDIUM';
    }

    return {
      trackingNumber,
      role: UserRole.RECIPIENT,
      recipientStopId,
      notification: {
        type: oldPosition !== newPosition ? 'SEQUENCE_CHANGE' : 'ETA_UPDATE',
        title,
        message,
        priority,
        oldETA,
        newETA,
        oldPosition,
        newPosition,
      },
      timestamp: event.timestamp,
    };
  }

  /**
   * Generate manager-specific notification
   */
  private generateManagerNotification(
    event: RerouteEvent,
    trackingNumber: string
  ): StakeholderNotification {
    const { changes, eventType, triggeredBy } = event;

    const title = triggeredBy === 'AUTOMATIC' 
      ? '🤖 Automatic Reroute Applied'
      : '✅ Manual Reroute Confirmed';

    const message = `${eventType.replace(/_/g, ' ')}: ${changes.reason}. ${changes.affectedStops.length} stops updated.`;

    return {
      trackingNumber,
      role: UserRole.MANAGER,
      notification: {
        type: 'REROUTE',
        title,
        message,
        priority: 'MEDIUM',
        routeChange: changes.routeChange ? {
          reason: changes.reason,
          oldRouteId: changes.routeChange.oldRouteId,
          newRouteId: changes.routeChange.newRouteId,
        } : undefined,
      },
      timestamp: event.timestamp,
    };
  }

  /**
   * Get stop position in sequence (mock implementation)
   */
  private getStopPosition(stopId: string, shipmentId: string, version: 'old' | 'new'): number {
    // TODO: Replace with actual database query
    // Query should fetch sequence_order from stops table
    
    // Example query:
    // SELECT sequence_order FROM stops 
    // WHERE id = $1 AND shipment_id = $2

    // Mock data
    const mockPositions: Record<string, { old: number; new: number }> = {
      'stop-3': { old: 3, new: 2 },
      'stop-5': { old: 5, new: 5 },
    };

    return mockPositions[stopId]?.[version] || 1;
  }

  /**
   * Deliver notification through appropriate channels
   */
  private async deliverNotification(notification: StakeholderNotification): Promise<void> {
    const prefs = this.preferences.get(notification.trackingNumber);

    // 1. Always queue in-app notification
    this.notificationQueue.push(notification);

    // 2. Trigger in-app delivery callbacks
    this.triggerDeliveryCallbacks(notification);

    // 3. Check notification preferences
    if (!prefs) {
      console.log(`No preferences for ${notification.trackingNumber}, using defaults`);
      await this.deliverThroughDefaultChannels(notification);
      return;
    }

    // 4. Deliver through enabled channels
    for (const channel of prefs.channels) {
      if (!channel.enabled) continue;

      switch (channel.type) {
        case 'IN_APP':
          // Already handled above
          break;

        case 'EMAIL':
          await this.sendEmailNotification(notification, channel.endpoint);
          break;

        case 'SMS':
          await this.sendSMSNotification(notification, channel.endpoint);
          break;

        case 'WEBHOOK':
          await this.sendWebhookNotification(notification, channel.endpoint);
          break;
      }
    }

    // 5. Persist to database
    await this.persistNotification(notification);
  }

  /**
   * Deliver through default channels (in-app only)
   */
  private async deliverThroughDefaultChannels(notification: StakeholderNotification): Promise<void> {
    // Default: in-app only (already queued)
    await this.persistNotification(notification);
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(notification: StakeholderNotification, email?: string): Promise<void> {
    // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
    console.log(`📧 Email notification sent to ${email}:`, notification.notification.title);
  }

  /**
   * Send SMS notification
   */
  private async sendSMSNotification(notification: StakeholderNotification, phone?: string): Promise<void> {
    // TODO: Integrate with SMS service (Twilio, AWS SNS, etc.)
    console.log(`📱 SMS notification sent to ${phone}:`, notification.notification.message);
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(notification: StakeholderNotification, webhookUrl?: string): Promise<void> {
    if (!webhookUrl) return;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.statusText}`);
      }

      console.log(`🔗 Webhook notification sent to ${webhookUrl}`);
    } catch (error) {
      console.error(`Failed to send webhook to ${webhookUrl}:`, error);
    }
  }

  /**
   * Persist notification to database
   */
  private async persistNotification(notification: StakeholderNotification): Promise<void> {
    // TODO: Insert into notifications table
    
    // Example query (PostgreSQL):
    // INSERT INTO notifications (
    //   tracking_number, notification_type, message,
    //   old_eta, new_eta, old_position, new_position, created_at
    // ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())

    console.log(`💾 Persisted notification to database: ${notification.trackingNumber}`);
  }

  /**
   * Trigger delivery callbacks for in-app subscriptions
   */
  private triggerDeliveryCallbacks(notification: StakeholderNotification): void {
    const callbacks = this.deliveryCallbacks.get(notification.trackingNumber) || [];
    callbacks.forEach(callback => callback(notification));
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Set notification preferences for a tracking number
   */
  setPreferences(trackingNumber: string, preferences: NotificationPreferences): void {
    this.preferences.set(trackingNumber, preferences);
    console.log(`📝 Updated preferences for ${trackingNumber}`);
  }

  /**
   * Subscribe to notifications for a specific tracking number
   */
  subscribe(trackingNumber: string, callback: (notification: StakeholderNotification) => void): () => void {
    if (!this.deliveryCallbacks.has(trackingNumber)) {
      this.deliveryCallbacks.set(trackingNumber, []);
    }

    this.deliveryCallbacks.get(trackingNumber)!.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.deliveryCallbacks.get(trackingNumber) || [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get unread notifications for a tracking number
   */
  getUnreadNotifications(trackingNumber: string): StakeholderNotification[] {
    return this.notificationQueue.filter(n => n.trackingNumber === trackingNumber);
  }

  /**
   * Mark notification as read
   */
  markAsRead(trackingNumber: string, timestamp: Date): void {
    const index = this.notificationQueue.findIndex(
      n => n.trackingNumber === trackingNumber && n.timestamp === timestamp
    );

    if (index > -1) {
      this.notificationQueue.splice(index, 1);
    }

    // TODO: Update database
    // UPDATE notifications SET is_read = true WHERE ...
  }

  /**
   * Clear all notifications for a tracking number
   */
  clearNotifications(trackingNumber: string): void {
    this.notificationQueue = this.notificationQueue.filter(
      n => n.trackingNumber !== trackingNumber
    );
  }

  /**
   * Manually trigger propagation (useful for testing or manual reroutes)
   */
  async manualPropagate(event: RerouteEvent): Promise<void> {
    await this.propagateRerouteEvent(event);
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const notificationPropagationService = new NotificationPropagationService();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate supplier update payload
 */
export function createSupplierUpdate(
  shipmentId: string,
  trackingNumber: string,
  event: RerouteEvent
): SupplierUpdate {
  const newETAs = Object.values(event.changes.newETAs);
  const finalETA = Math.max(...newETAs);

  return {
    shipmentId,
    trackingNumber,
    updates: {
      newETA: finalETA,
      routeSummary: event.changes.routeChange 
        ? `Route changed to ${event.changes.routeChange.newRouteId}`
        : undefined,
      rerouteReason: event.changes.reason,
      affectedStops: event.changes.affectedStops,
    },
  };
}

/**
 * Generate receiver update payload
 */
export function createReceiverUpdate(
  shipmentId: string,
  trackingNumber: string,
  recipientStopId: string,
  event: RerouteEvent,
  oldPosition: number,
  newPosition: number,
  totalStops: number
): ReceiverUpdate {
  return {
    shipmentId,
    trackingNumber,
    recipientStopId,
    updates: {
      newETA: event.changes.newETAs[recipientStopId],
      oldPosition,
      newPosition,
      totalStops,
      optimizationMessage: oldPosition !== newPosition
        ? `Your delivery position changed from ${oldPosition} to ${newPosition} of ${totalStops} to optimize the route.`
        : undefined,
    },
  };
}
