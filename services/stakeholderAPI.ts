/**
 * API Endpoints for Supplier and Receiver Views
 * Provides role-based access to shipment data
 * Ensures consistent updates propagate to all stakeholders
 */

import { trackingNumberManager } from './trackingNumberManager';
import { notificationPropagationService, StakeholderNotification } from './notificationPropagationService';

// ============================================================================
// TYPES
// ============================================================================

export interface SupplierDashboardData {
  shipments: SupplierShipment[];
  summary: {
    totalShipments: number;
    inTransit: number;
    delivered: number;
    delayed: number;
  };
  recentReroutes: RerouteNotification[];
}

export interface SupplierShipment {
  shipmentId: string;
  trackingNumber: string;
  status: string;
  origin: LocationInfo;
  destination: LocationInfo;
  currentETA: number;
  previousETA?: number;
  routeSummary?: string;
  progress: number; // 0-100
  stops: StopInfo[];
  lastUpdate: Date;
  delayExplanation?: string;
}

export interface ReceiverTrackingData {
  shipmentId: string;
  trackingNumber: string;
  status: string;
  deliveryPosition: number;
  totalStops: number;
  myETA: number;
  previousETA?: number;
  currentLocation?: LocationInfo;
  myStop: StopInfo;
  deliveryWindow?: {
    earliest: number;
    latest: number;
  };
  optimizationMessage?: string;
  notifications: ReceiverNotification[];
  delayExplanation?: string;
}

export interface LocationInfo {
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
}

export interface StopInfo {
  stopId: string;
  name: string;
  latitude: number;
  longitude: number;
  sequenceOrder: number;
  status: string;
  estimatedArrival: number;
  actualArrival?: number;
  unloadingTime: number;
}

export interface RerouteNotification {
  eventId: string;
  timestamp: Date;
  shipmentId: string;
  reason: string;
  impact: string;
  oldETA: number;
  newETA: number;
}

export interface ReceiverNotification {
  notificationId: string;
  type: 'ETA_UPDATE' | 'REROUTE' | 'SEQUENCE_CHANGE' | 'DELIVERY_STATUS';
  title: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
}

// ============================================================================
// SUPPLIER API ENDPOINTS
// ============================================================================

export class SupplierAPI {
  /**
   * Get supplier dashboard data
   * Endpoint: GET /api/supplier/dashboard?trackingNumber=SUPP-XXX
   */
  async getDashboard(supplierTrackingNumber: string): Promise<SupplierDashboardData> {
    // 1. Validate tracking number
    const isValid = await trackingNumberManager.isValid(supplierTrackingNumber);
    if (!isValid) {
      throw new Error('Invalid or expired tracking number');
    }

    // 2. Get tracking number record
    const trackingRecord = await trackingNumberManager.findByTrackingNumber(supplierTrackingNumber);
    if (!trackingRecord || trackingRecord.role !== 'SUPPLIER') {
      throw new Error('Unauthorized: This is not a supplier tracking number');
    }

    // 3. Get shipment data
    const shipmentId = trackingRecord.shipmentId;
    const shipment = await this.getSupplierShipment(shipmentId);

    // 4. Get summary statistics (in real implementation, query multiple shipments)
    const summary = {
      totalShipments: 1,
      inTransit: shipment.status.includes('TRANSIT') ? 1 : 0,
      delivered: shipment.status === 'DELIVERED' ? 1 : 0,
      delayed: shipment.status === 'DELAYED' ? 1 : 0,
    };

    // 5. Get recent reroutes
    const recentReroutes = await this.getRecentReroutes(shipmentId);

    return {
      shipments: [shipment],
      summary,
      recentReroutes,
    };
  }

  /**
   * Get detailed shipment data for supplier
   * Endpoint: GET /api/supplier/shipment/:shipmentId?trackingNumber=SUPP-XXX
   */
  async getSupplierShipment(shipmentId: string): Promise<SupplierShipment> {
    // TODO: Query database for shipment details

    // Example query:
    // SELECT s.*, 
    //        origin.name as origin_name, origin.latitude as origin_lat, origin.longitude as origin_lng,
    //        hub.name as hub_name
    // FROM shipments s
    // LEFT JOIN stops origin ON s.origin_stop_id = origin.id
    // LEFT JOIN stops hub ON s.hub_stop_id = hub.id
    // WHERE s.id = $1

    // Mock data
    return {
      shipmentId,
      trackingNumber: 'SHIP001',
      status: 'IN_TRANSIT_LONG_HAUL',
      origin: {
        name: 'Austin Warehouse',
        latitude: 30.2672,
        longitude: -97.7431,
      },
      destination: {
        name: 'Beaumont Hub',
        latitude: 30.0860,
        longitude: -94.1018,
      },
      currentETA: Date.now() + 2 * 60 * 60 * 1000, // 2 hours from now
      routeSummary: 'I-10 East via Houston',
      progress: 45,
      stops: [],
      lastUpdate: new Date(),
      delayExplanation: 'Heavy traffic on I-10 is causing a 15-minute delay.',
    };
  }

  /**
   * Get recent reroutes for a shipment
   */
  private async getRecentReroutes(shipmentId: string): Promise<RerouteNotification[]> {
    // TODO: Query reroute_events table

    // Example query:
    // SELECT id, created_at, event_type, changes
    // FROM reroute_events
    // WHERE shipment_id = $1
    // ORDER BY created_at DESC
    // LIMIT 10

    return [];
  }

  /**
   * Get shipment updates (SSE or WebSocket endpoint)
   * Endpoint: GET /api/supplier/updates?trackingNumber=SUPP-XXX (SSE)
   */
  async subscribeToUpdates(
    supplierTrackingNumber: string,
    callback: (update: SupplierShipment) => void
  ): Promise<() => void> {
    // Subscribe to notification service
    return notificationPropagationService.subscribe(
      supplierTrackingNumber,
      (notification: StakeholderNotification) => {
        // Convert notification to supplier update and call callback
        this.getSupplierShipment(notification.trackingNumber).then(callback);
      }
    );
  }
}

// ============================================================================
// RECEIVER API ENDPOINTS
// ============================================================================

export class ReceiverAPI {
  /**
   * Get receiver tracking data
   * Endpoint: GET /api/receiver/track/:trackingNumber
   */
  async getTrackingData(receiverTrackingNumber: string): Promise<ReceiverTrackingData> {
    // 1. Validate tracking number
    const isValid = await trackingNumberManager.isValid(receiverTrackingNumber);
    if (!isValid) {
      throw new Error('Invalid or expired tracking number');
    }

    // 2. Get tracking number record
    const trackingRecord = await trackingNumberManager.findByTrackingNumber(receiverTrackingNumber);
    if (!trackingRecord || trackingRecord.role !== 'RECIPIENT') {
      throw new Error('Unauthorized: This is not a recipient tracking number');
    }

    // 3. Get shipment data
    const { shipmentId, recipientStopId } = trackingRecord;

    if (!recipientStopId) {
      throw new Error('No recipient stop associated with this tracking number');
    }

    // 4. Get stop details
    const myStop = await this.getStopDetails(recipientStopId);

    // 5. Get delivery position
    const { position, totalStops } = await this.getDeliveryPosition(shipmentId, recipientStopId);

    // 6. Get shipment status
    const shipmentStatus = await this.getShipmentStatus(shipmentId);

    // 7. Get notifications
    const notifications = await this.getNotifications(receiverTrackingNumber);

    // 8. Get current truck location (if in transit)
    const currentLocation = await this.getCurrentLocation(shipmentId);

    return {
      shipmentId,
      trackingNumber: receiverTrackingNumber,
      status: shipmentStatus,
      deliveryPosition: position,
      totalStops,
      myETA: myStop.estimatedArrival,
      currentLocation,
      myStop,
      notifications,
      delayExplanation: 'Weather conditions are slowing down the delivery slightly.',
    };
  }

  /**
   * Get stop details
   */
  private async getStopDetails(stopId: string): Promise<StopInfo> {
    // TODO: Query stops table

    // Example query:
    // SELECT id, name, latitude, longitude, sequence_order, status,
    //        estimated_arrival_time, actual_arrival_time, unloading_time_minutes
    // FROM stops
    // WHERE id = $1

    // Mock data
    return {
      stopId,
      name: 'Customer Location',
      latitude: 29.7604,
      longitude: -95.3698,
      sequenceOrder: 3,
      status: 'PENDING',
      estimatedArrival: Date.now() + 4 * 60 * 60 * 1000, // 4 hours
      unloadingTime: 15,
    };
  }

  /**
   * Get delivery position in sequence
   */
  private async getDeliveryPosition(
    shipmentId: string,
    stopId: string
  ): Promise<{ position: number; totalStops: number }> {
    // TODO: Query stops table

    // Example query:
    // SELECT sequence_order,
    //        (SELECT COUNT(*) FROM stops WHERE shipment_id = $1 AND stop_type = 'LAST_MILE') as total
    // FROM stops
    // WHERE id = $2

    // Mock data
    return {
      position: 3,
      totalStops: 7,
    };
  }

  /**
   * Get shipment status
   */
  private async getShipmentStatus(shipmentId: string): Promise<string> {
    // TODO: Query shipments table

    // Example query:
    // SELECT status FROM shipments WHERE id = $1

    return 'IN_TRANSIT_LAST_MILE';
  }

  /**
   * Get current truck location
   */
  private async getCurrentLocation(shipmentId: string): Promise<LocationInfo | undefined> {
    // TODO: Get real-time location from tracking system

    // In production, this would query a real-time location service
    // For now, return undefined
    return undefined;
  }

  /**
   * Get notifications for tracking number
   */
  private async getNotifications(trackingNumber: string): Promise<ReceiverNotification[]> {
    // TODO: Query notifications table

    // Example query:
    // SELECT id, notification_type, message, created_at, is_read
    // FROM notifications
    // WHERE tracking_number = $1
    // ORDER BY created_at DESC
    // LIMIT 20

    const stakeholderNotifications = notificationPropagationService.getUnreadNotifications(trackingNumber);

    return stakeholderNotifications.map(n => ({
      notificationId: `${n.trackingNumber}-${n.timestamp.getTime()}`,
      type: n.notification.type,
      title: n.notification.title,
      message: n.notification.message,
      timestamp: n.timestamp,
      isRead: false,
    }));
  }

  /**
   * Mark notification as read
   * Endpoint: POST /api/receiver/notifications/:notificationId/read
   */
  async markNotificationAsRead(trackingNumber: string, notificationId: string): Promise<void> {
    // Extract timestamp from notification ID
    const timestamp = new Date(parseInt(notificationId.split('-').pop() || '0'));

    notificationPropagationService.markAsRead(trackingNumber, timestamp);

    // TODO: Update database
    // UPDATE notifications SET is_read = true WHERE id = $1
  }

  /**
   * Subscribe to real-time updates (SSE or WebSocket)
   * Endpoint: GET /api/receiver/updates/:trackingNumber (SSE)
   */
  async subscribeToUpdates(
    receiverTrackingNumber: string,
    callback: (update: ReceiverTrackingData) => void
  ): Promise<() => void> {
    // Subscribe to notification service
    return notificationPropagationService.subscribe(
      receiverTrackingNumber,
      (notification: StakeholderNotification) => {
        // Fetch fresh data and send to callback
        this.getTrackingData(receiverTrackingNumber).then(callback);
      }
    );
  }

  /**
   * Estimate delivery window based on stop sequence
   * Endpoint: GET /api/receiver/delivery-window/:trackingNumber
   */
  async getDeliveryWindow(receiverTrackingNumber: string): Promise<{
    earliest: number;
    latest: number;
    confidence: number;
  }> {
    const trackingData = await this.getTrackingData(receiverTrackingNumber);

    // Calculate window based on stop sequence
    const avgStopTime = 15; // minutes
    const variance = 10; // minutes per stop

    const earliestOffset = -variance * trackingData.deliveryPosition;
    const latestOffset = variance * trackingData.deliveryPosition;

    return {
      earliest: trackingData.myETA + earliestOffset * 60 * 1000,
      latest: trackingData.myETA + latestOffset * 60 * 1000,
      confidence: Math.max(0.5, 1 - (trackingData.deliveryPosition * 0.05)),
    };
  }
}

// ============================================================================
// MANAGER API ENDPOINTS (Enhanced)
// ============================================================================

export class ManagerAPI {
  /**
   * Get all shipments (manager view)
   * Endpoint: GET /api/manager/shipments?trackingNumber=MGR-XXX
   */
  async getAllShipments(managerTrackingNumber: string): Promise<SupplierShipment[]> {
    // Validate manager access
    const trackingRecord = await trackingNumberManager.findByTrackingNumber(managerTrackingNumber);
    if (!trackingRecord || trackingRecord.role !== 'MANAGER') {
      throw new Error('Unauthorized: Manager access required');
    }

    // TODO: Query all shipments
    // SELECT * FROM active_shipments ORDER BY created_at DESC

    return [];
  }

  /**
   * Get all tracking numbers for a shipment
   * Endpoint: GET /api/manager/shipment/:shipmentId/tracking-numbers
   */
  async getTrackingNumbers(shipmentId: string): Promise<{
    supplier: string[];
    recipients: Array<{ trackingNumber: string; stopName: string; status: string }>;
    manager: string[];
  }> {
    const allTracking = await trackingNumberManager.getTrackingNumbersForShipment(shipmentId);

    return {
      supplier: allTracking.filter(t => t.role === 'SUPPLIER').map(t => t.trackingNumber),
      recipients: allTracking
        .filter(t => t.role === 'RECIPIENT')
        .map(t => ({
          trackingNumber: t.trackingNumber,
          stopName: t.recipientStopId || 'Unknown',
          status: t.status,
        })),
      manager: allTracking.filter(t => t.role === 'MANAGER').map(t => t.trackingNumber),
    };
  }

  /**
   * Manually trigger reroute propagation
   * Endpoint: POST /api/manager/shipment/:shipmentId/notify-stakeholders
   */
  async notifyAllStakeholders(shipmentId: string, message: string): Promise<void> {
    // Get all tracking numbers
    const trackingNumbers = await trackingNumberManager.getTrackingNumbersForShipment(shipmentId);

    // TODO: Create custom notifications for each stakeholder
    console.log(`Notifying ${trackingNumbers.length} stakeholders for shipment ${shipmentId}`);
  }
}

// ============================================================================
// API ROUTER (Express-style routes)
// ============================================================================

export class APIRouter {
  private supplierAPI = new SupplierAPI();
  private receiverAPI = new ReceiverAPI();
  private managerAPI = new ManagerAPI();

  /**
   * Initialize all routes
   * Call this in your Express/Fastify app setup
   */
  setupRoutes(app: any): void {
    // Supplier routes
    app.get('/api/supplier/dashboard', async (req: any, res: any) => {
      try {
        const { trackingNumber } = req.query;
        const data = await this.supplierAPI.getDashboard(trackingNumber);
        res.json(data);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    app.get('/api/supplier/shipment/:shipmentId', async (req: any, res: any) => {
      try {
        const { shipmentId } = req.params;
        const data = await this.supplierAPI.getSupplierShipment(shipmentId);
        res.json(data);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    // Receiver routes
    app.get('/api/receiver/track/:trackingNumber', async (req: any, res: any) => {
      try {
        const { trackingNumber } = req.params;
        const data = await this.receiverAPI.getTrackingData(trackingNumber);
        res.json(data);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    app.get('/api/receiver/delivery-window/:trackingNumber', async (req: any, res: any) => {
      try {
        const { trackingNumber } = req.params;
        const data = await this.receiverAPI.getDeliveryWindow(trackingNumber);
        res.json(data);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    app.post('/api/receiver/notifications/:notificationId/read', async (req: any, res: any) => {
      try {
        const { notificationId } = req.params;
        const { trackingNumber } = req.body;
        await this.receiverAPI.markNotificationAsRead(trackingNumber, notificationId);
        res.json({ success: true });
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    // Manager routes
    app.get('/api/manager/shipments', async (req: any, res: any) => {
      try {
        const { trackingNumber } = req.query;
        const data = await this.managerAPI.getAllShipments(trackingNumber);
        res.json(data);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    app.get('/api/manager/shipment/:shipmentId/tracking-numbers', async (req: any, res: any) => {
      try {
        const { shipmentId } = req.params;
        const data = await this.managerAPI.getTrackingNumbers(shipmentId);
        res.json(data);
      } catch (error: any) {
        res.status(400).json({ error: error.message });
      }
    });

    console.log('✅ API routes configured');
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const supplierAPI = new SupplierAPI();
export const receiverAPI = new ReceiverAPI();
export const managerAPI = new ManagerAPI();
export const apiRouter = new APIRouter();
