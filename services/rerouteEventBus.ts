/**
 * Reroute Event Bus
 * Manages event-driven updates for rerouting actions
 * Propagates changes to all affected tracking numbers
 */

import { UserRole } from '../types';

export interface RerouteEvent {
  eventId: string;
  timestamp: Date;
  shipmentId: string;
  eventType: 'LONG_HAUL_REROUTE' | 'LAST_MILE_RESEQUENCE' | 'ROUTE_SWITCH';
  changes: {
    affectedStops: string[];
    oldETAs: Record<string, number>;
    newETAs: Record<string, number>;
    reason: string;
    routeChange?: {
      oldRouteId: string;
      newRouteId: string;
    };
  };
  triggeredBy: 'MANAGER' | 'AUTOMATIC';
}

export interface TrackingInfo {
  role: UserRole;
  shipmentId: string;
  recipientStopId?: string;
  trackingNumber: string;
}

export interface NotificationPayload {
  type: 'ETA_UPDATE' | 'REROUTE' | 'SEQUENCE_CHANGE';
  message: string;
  newETA?: number;
  oldETA?: number;
  newPosition?: number;
  oldPosition?: number;
}

/**
 * Event Bus for rerouting notifications
 */
class RerouteEventBus {
  private listeners: Map<string, ((event: RerouteEvent) => void)[]> = new Map();
  private eventHistory: RerouteEvent[] = [];
  private maxHistorySize = 100;

  /**
   * Subscribe to reroute events for a specific shipment
   */
  subscribe(shipmentId: string, callback: (event: RerouteEvent) => void): () => void {
    if (!this.listeners.has(shipmentId)) {
      this.listeners.set(shipmentId, []);
    }
    
    this.listeners.get(shipmentId)!.push(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(shipmentId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Publish a reroute event to all subscribers
   */
  async publishRerouteEvent(event: RerouteEvent): Promise<void> {
    console.log('📡 Publishing reroute event:', event.eventType, event.eventId);
    
    try {
      // 1. Add to history
      this.eventHistory.unshift(event);
      if (this.eventHistory.length > this.maxHistorySize) {
        this.eventHistory.pop();
      }
      
      // 2. Store in localStorage for persistence
      this.persistEvent(event);
      
      // 3. Notify all subscribers
      const callbacks = this.listeners.get(event.shipmentId) || [];
      callbacks.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error('Error in reroute event callback:', error);
        }
      });
      
      // 4. Generate notifications for affected tracking numbers
      await this.notifyAffectedParties(event);
      
      console.log('✅ Reroute event published successfully');
    } catch (error) {
      console.error('Error publishing reroute event:', error);
      throw error;
    }
  }

  /**
   * Get event history for a shipment
   */
  getEventHistory(shipmentId?: string): RerouteEvent[] {
    if (shipmentId) {
      return this.eventHistory.filter(e => e.shipmentId === shipmentId);
    }
    return [...this.eventHistory];
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
    try {
      localStorage.removeItem('reroute_event_history');
    } catch (error) {
      console.error('Error clearing event history:', error);
    }
  }

  /**
   * Persist event to localStorage
   */
  private persistEvent(event: RerouteEvent): void {
    try {
      const stored = localStorage.getItem('reroute_event_history');
      const history: RerouteEvent[] = stored ? JSON.parse(stored) : [];
      
      history.unshift({
        ...event,
        timestamp: event.timestamp.toISOString() as any
      });
      
      // Keep only last 50 events
      if (history.length > 50) {
        history.splice(50);
      }
      
      localStorage.setItem('reroute_event_history', JSON.stringify(history));
    } catch (error) {
      console.warn('Could not persist reroute event:', error);
    }
  }

  /**
   * Notify affected parties (suppliers, receivers)
   */
  private async notifyAffectedParties(event: RerouteEvent): Promise<void> {
    // Get tracking numbers from localStorage (will use database in Phase 4)
    const trackingNumberMap = this.getTrackingNumberMap();
    
    const affectedNumbers = Object.entries(trackingNumberMap)
      .filter(([_, info]) => (info as any).shipmentId === event.shipmentId)
      .map(([trackingNumber, info]) => ({
        trackingNumber,
        ...(info as any)
      }));
    
    for (const trackingInfo of affectedNumbers) {
      const notification = this.buildNotification(trackingInfo, event);
      
      // Show browser notification if available
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Delivery Update', {
          body: notification.message,
          icon: '/truck-icon.png'
        });
      }
      
      // Log notification (will be sent via email/SMS in production)
      console.log(`📬 Notification for ${trackingInfo.trackingNumber}:`, notification);
      
      // Store notification in queue for UI display
      this.queueNotification(trackingInfo.trackingNumber, notification);
    }
  }

  /**
   * Build notification message based on role
   */
  private buildNotification(
    trackingInfo: TrackingInfo & { trackingNumber: string },
    event: RerouteEvent
  ): NotificationPayload {
    const { role, recipientStopId } = trackingInfo;
    
    if (role === UserRole.SUPPLIER) {
      const hubETA = event.changes.newETAs['hub'] || event.changes.newETAs[Object.keys(event.changes.newETAs)[0]];
      return {
        type: 'ETA_UPDATE',
        message: `Route optimized. Delivery ETA updated to ${hubETA} minutes. ${event.changes.reason}`,
        newETA: hubETA,
        oldETA: event.changes.oldETAs['hub']
      };
    }
    
    if (role === UserRole.RECIPIENT && recipientStopId) {
      const oldETA = event.changes.oldETAs[recipientStopId];
      const newETA = event.changes.newETAs[recipientStopId];
      const diff = newETA - oldETA;
      
      if (event.eventType === 'LAST_MILE_RESEQUENCE') {
        const oldPosition = event.changes.affectedStops.indexOf(recipientStopId) + 1;
        const newStops = Object.keys(event.changes.newETAs);
        const newPosition = newStops.indexOf(recipientStopId) + 1;
        
        return {
          type: 'SEQUENCE_CHANGE',
          message: `Delivery sequence optimized. You are now stop ${newPosition} of ${newStops.length}. ` +
                   `New ETA: ${newETA} minutes (${diff > 0 ? '+' : ''}${diff} min). ${event.changes.reason}`,
          newETA,
          oldETA,
          newPosition,
          oldPosition
        };
      }
      
      return {
        type: 'ETA_UPDATE',
        message: `Route updated. New ETA: ${newETA} minutes (${diff > 0 ? '+' : ''}${diff} min). ${event.changes.reason}`,
        newETA,
        oldETA
      };
    }
    
    // Manager or fallback
    return {
      type: 'REROUTE',
      message: `Route updated. ${event.changes.reason}`
    };
  }

  /**
   * Get tracking number map from localStorage
   */
  private getTrackingNumberMap(): Record<string, Partial<TrackingInfo>> {
    try {
      const stored = localStorage.getItem('trackingNumberMap');
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Error reading tracking number map:', error);
      return {};
    }
  }

  /**
   * Queue notification for UI display
   */
  private queueNotification(trackingNumber: string, notification: NotificationPayload): void {
    try {
      const queueKey = `notifications_${trackingNumber}`;
      const stored = localStorage.getItem(queueKey);
      const queue: (NotificationPayload & { timestamp: string })[] = stored ? JSON.parse(stored) : [];
      
      queue.unshift({
        ...notification,
        timestamp: new Date().toISOString()
      });
      
      // Keep only last 20 notifications
      if (queue.length > 20) {
        queue.splice(20);
      }
      
      localStorage.setItem(queueKey, JSON.stringify(queue));
    } catch (error) {
      console.warn('Could not queue notification:', error);
    }
  }

  /**
   * Get notifications for a tracking number
   */
  getNotifications(trackingNumber: string): (NotificationPayload & { timestamp: Date })[] {
    try {
      const queueKey = `notifications_${trackingNumber}`;
      const stored = localStorage.getItem(queueKey);
      if (!stored) return [];
      
      const queue = JSON.parse(stored);
      return queue.map((n: any) => ({
        ...n,
        timestamp: new Date(n.timestamp)
      }));
    } catch (error) {
      console.error('Error reading notifications:', error);
      return [];
    }
  }

  /**
   * Clear notifications for a tracking number
   */
  clearNotifications(trackingNumber: string): void {
    try {
      const queueKey = `notifications_${trackingNumber}`;
      localStorage.removeItem(queueKey);
    } catch (error) {
      console.error('Error clearing notifications:', error);
    }
  }
}

// Export singleton instance
export const rerouteEventBus = new RerouteEventBus();

// Request notification permission on load
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}
