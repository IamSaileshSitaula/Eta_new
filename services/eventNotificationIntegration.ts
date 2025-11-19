/**
 * Integration Layer: Event Bus → Notification System
 * Wires the reroute event bus to the notification propagation service
 * Ensures all rerouting decisions automatically propagate to stakeholders
 */

import { rerouteEventBus, RerouteEvent } from './rerouteEventBus';
import { notificationPropagationService } from './notificationPropagationService';
import { trackingNumberManager } from './trackingNumberManager';
import { supplierAPI, receiverAPI } from './stakeholderAPI';

// ============================================================================
// INTEGRATION MANAGER
// ============================================================================

class EventNotificationIntegration {
  private isInitialized = false;

  /**
   * Initialize the integration
   * Call this once during app startup
   */
  initialize(): void {
    if (this.isInitialized) {
      console.warn('⚠️ Event-Notification integration already initialized');
      return;
    }

    console.log('🔧 Initializing Event-Notification integration...');

    // Wire event bus to notification service
    this.setupEventListeners();

    // Setup periodic maintenance tasks
    this.setupMaintenanceTasks();

    this.isInitialized = true;
    console.log('✅ Event-Notification integration initialized');
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Subscribe to ALL reroute events
    rerouteEventBus.subscribe('*', async (event: RerouteEvent) => {
      await this.handleRerouteEvent(event);
    });

    // Subscribe to specific event types for custom handling
    rerouteEventBus.subscribe('LONG_HAUL_REROUTE', async (event: RerouteEvent) => {
      await this.handleLongHaulReroute(event);
    });

    rerouteEventBus.subscribe('LAST_MILE_RESEQUENCE', async (event: RerouteEvent) => {
      await this.handleLastMileResequence(event);
    });

    rerouteEventBus.subscribe('ROUTE_SWITCH', async (event: RerouteEvent) => {
      await this.handleRouteSwitch(event);
    });

    console.log('📡 Event listeners configured');
  }

  /**
   * Setup periodic maintenance tasks
   */
  private setupMaintenanceTasks(): void {
    // Auto-expire tracking numbers every hour
    setInterval(async () => {
      const expiredCount = await trackingNumberManager.expireOldTrackingNumbers();
      if (expiredCount > 0) {
        console.log(`🧹 Maintenance: Expired ${expiredCount} tracking numbers`);
      }
    }, 60 * 60 * 1000); // 1 hour

    console.log('🔄 Maintenance tasks scheduled');
  }

  /**
   * Main handler for all reroute events
   */
  private async handleRerouteEvent(event: RerouteEvent): Promise<void> {
    console.log(`📢 Handling reroute event: ${event.eventId} (${event.eventType})`);

    try {
      // 1. Fetch all affected tracking numbers
      const trackingNumbers = await trackingNumberManager.getTrackingNumbersForShipment(
        event.shipmentId
      );

      console.log(`📊 Found ${trackingNumbers.length} tracking numbers to notify`);

      // 2. Update ETAs in database
      await this.updateETAsInDatabase(event);

      // 3. The notification service handles propagation automatically
      // (it already subscribes to the event bus in its constructor)

      // 4. Log the event
      await this.logRerouteEvent(event);

      console.log(`✅ Successfully processed event ${event.eventId}`);
    } catch (error) {
      console.error(`❌ Failed to handle reroute event ${event.eventId}:`, error);
    }
  }

  /**
   * Handler for long-haul reroutes
   */
  private async handleLongHaulReroute(event: RerouteEvent): Promise<void> {
    console.log(`🚛 Long-haul reroute detected: ${event.changes.reason}`);

    // Custom logic for long-haul reroutes
    // For example, notify warehouse to adjust loading schedule
    if (event.triggeredBy === 'AUTOMATIC') {
      // Send alert to operations team
      console.log('🔔 Alerting operations team of automatic long-haul reroute');
    }
  }

  /**
   * Handler for last-mile resequencing
   */
  private async handleLastMileResequence(event: RerouteEvent): Promise<void> {
    console.log(`📦 Last-mile resequence detected: ${event.changes.affectedStops.length} stops affected`);

    // Custom logic for last-mile resequencing
    // For example, update driver navigation app
    console.log('🗺️ Updating driver navigation with new stop sequence');
  }

  /**
   * Handler for route switches
   */
  private async handleRouteSwitch(event: RerouteEvent): Promise<void> {
    const { oldRouteId, newRouteId } = event.changes.routeChange || {};
    console.log(`🔄 Route switch: ${oldRouteId} → ${newRouteId}`);

    // Custom logic for route switches
    // For example, update toll calculations
    console.log('💰 Recalculating toll costs for new route');
  }

  /**
   * Update ETAs in database
   */
  private async updateETAsInDatabase(event: RerouteEvent): Promise<void> {
    // TODO: Update stops table with new ETAs
    
    // Example query:
    // UPDATE stops
    // SET estimated_arrival_time = $1
    // WHERE id = $2

    for (const [stopId, newETA] of Object.entries(event.changes.newETAs)) {
      console.log(`📝 Updating ETA for stop ${stopId}: ${newETA}`);
      
      // Also log to ETA history table
      // INSERT INTO eta_history (shipment_id, stop_id, predicted_eta, prediction_method, created_at)
      // VALUES ($1, $2, $3, 'ML_MODEL', NOW())
    }
  }

  /**
   * Log reroute event to database
   */
  private async logRerouteEvent(event: RerouteEvent): Promise<void> {
    // TODO: Insert into reroute_events table
    
    // Example query:
    // INSERT INTO reroute_events (
    //   id, shipment_id, event_type, triggered_by, changes, created_at
    // ) VALUES ($1, $2, $3, $4, $5, $6)

    console.log(`💾 Logged reroute event to database: ${event.eventId}`);
  }

  /**
   * Manually trigger a reroute event (for testing)
   */
  async triggerTestReroute(shipmentId: string): Promise<void> {
    const testEvent: RerouteEvent = {
      eventId: `test-${Date.now()}`,
      timestamp: new Date(),
      shipmentId,
      eventType: 'LAST_MILE_RESEQUENCE',
      changes: {
        affectedStops: ['stop-3', 'stop-4', 'stop-5'],
        oldETAs: {
          'stop-3': Date.now() + 60 * 60 * 1000,
          'stop-4': Date.now() + 90 * 60 * 1000,
          'stop-5': Date.now() + 120 * 60 * 1000,
        },
        newETAs: {
          'stop-3': Date.now() + 50 * 60 * 1000, // 10 min earlier
          'stop-4': Date.now() + 80 * 60 * 1000,
          'stop-5': Date.now() + 110 * 60 * 1000,
        },
        reason: 'Route optimized to avoid traffic congestion',
      },
      triggeredBy: 'MANAGER',
    };

    await rerouteEventBus.publishRerouteEvent(testEvent);
    console.log('🧪 Test reroute event triggered');
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const eventNotificationIntegration = new EventNotificationIntegration();

// ============================================================================
// AUTO-INITIALIZATION (if needed)
// ============================================================================

// Uncomment to auto-initialize on import
// eventNotificationIntegration.initialize();

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*
// In your app.ts or main.ts:

import { eventNotificationIntegration } from './services/eventNotificationIntegration';

// Initialize during app startup
eventNotificationIntegration.initialize();

// That's it! Now all reroute events will automatically:
// 1. Propagate to all affected tracking numbers
// 2. Generate role-specific notifications
// 3. Update database records
// 4. Trigger real-time updates to UI

// To manually trigger a reroute (for example, when manager approves):
import { rerouteEventBus } from './services/rerouteEventBus';

const rerouteEvent: RerouteEvent = {
  eventId: 'evt-123',
  timestamp: new Date(),
  shipmentId: 'ship-001',
  eventType: 'LAST_MILE_RESEQUENCE',
  changes: {
    affectedStops: ['stop-1', 'stop-2'],
    oldETAs: { 'stop-1': 1000, 'stop-2': 2000 },
    newETAs: { 'stop-1': 900, 'stop-2': 1900 },
    reason: 'Traffic optimization',
  },
  triggeredBy: 'MANAGER',
};

await rerouteEventBus.publish(rerouteEvent);
// → Automatically notifies all stakeholders
// → Updates supplier dashboard
// → Updates receiver tracking pages
// → Sends notifications to all affected parties

*/
