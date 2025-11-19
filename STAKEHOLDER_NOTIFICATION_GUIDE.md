# Stakeholder Notification & Tracking Number Lifecycle Guide

> **Complete implementation guide for reroute propagation and tracking number management**

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tracking Number Lifecycle](#tracking-number-lifecycle)
4. [Notification Propagation](#notification-propagation)
5. [Database Design](#database-design)
6. [API Endpoints](#api-endpoints)
7. [Integration Guide](#integration-guide)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## 🎯 Overview

This implementation solves two critical problems:

### Problem 1: Reroute Propagation
**Issue**: When a manager applies a reroute, suppliers and receivers don't get notified

**Solution**: 
- Event-driven notification system
- Role-based notification formatting
- Multi-channel delivery (in-app, email, SMS, webhook)
- Real-time updates via SSE/WebSocket

### Problem 2: Tracking Number Reuse
**Issue**: After system restart, the same tracking number cannot be reused

**Solution**:
- Soft delete pattern (ARCHIVED instead of DELETE)
- Idempotency keys prevent duplicate creation
- Lifecycle states (ACTIVE, EXPIRED, ARCHIVED, REVOKED)
- Reactivation support for archived numbers

---

## 🏗️ Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Manager Dashboard                         │
│                  (Initiates Reroutes)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
          ┌────────────────────────┐
          │  Reroute Event Bus     │ ← Central event dispatcher
          │  (rerouteEventBus.ts)  │
          └────────────┬───────────┘
                       │
                       ├──────────────────────────────────┐
                       ▼                                  ▼
    ┌──────────────────────────────┐    ┌────────────────────────────┐
    │ Notification Propagation     │    │ Event-Notification         │
    │ Service                      │    │ Integration                │
    │ (notificationPropagation     │    │ (eventNotification         │
    │  Service.ts)                 │    │  Integration.ts)           │
    └──────────┬───────────────────┘    └────────────┬───────────────┘
               │                                      │
               │  Fetches tracking numbers            │  Updates database
               ▼                                      ▼
    ┌──────────────────────────┐         ┌────────────────────────────┐
    │ Tracking Number Manager  │         │ PostgreSQL Database        │
    │ (trackingNumber          │◄────────│ - shipments                │
    │  Manager.ts)             │         │ - tracking_numbers         │
    └──────────┬───────────────┘         │ - reroute_events          │
               │                         │ - notifications            │
               │                         └────────────────────────────┘
               │
               │  Generates role-specific notifications
               │
               ├─────────────┬─────────────┬─────────────┐
               ▼             ▼             ▼             ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │   Supplier   │ │  Recipient   │ │  Recipient   │ │   Manager    │
    │   Dashboard  │ │  Tracking 1  │ │  Tracking 2  │ │   Dashboard  │
    └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

### Data Flow

**When a reroute happens:**

1. Manager approves reroute in `ManagerDashboard`
2. `RerouteEvent` published to `rerouteEventBus`
3. `notificationPropagationService` receives event
4. Service fetches all tracking numbers from `trackingNumberManager`
5. For each tracking number:
   - Generate role-specific notification content
   - Deliver through enabled channels (in-app, email, SMS, webhook)
   - Persist to database
6. `eventNotificationIntegration` updates ETAs in database
7. All stakeholder UIs receive real-time updates

---

## 🔑 Tracking Number Lifecycle

### States

| State | Description | Can Reuse? | Can Reactivate? |
|-------|-------------|------------|-----------------|
| `ACTIVE` | Currently in use | ❌ No | N/A |
| `EXPIRED` | Expiration date passed | ✅ Yes | ✅ Yes |
| `ARCHIVED` | Soft deleted (shipment delivered) | ✅ Yes | ✅ Yes |
| `REVOKED` | Manually revoked | ❌ No | ❌ No |

### Lifecycle Transitions

```
    CREATE
      │
      ▼
   ACTIVE ────────► EXPIRED ────────► ARCHIVED
      │                │                  │
      │                └──────┬───────────┘
      │                       │
      ▼                       ▼
   REVOKED              REACTIVATED → ACTIVE
   (permanent)               (allowed)
```

### Idempotency Pattern

**Problem**: Duplicate creation on retry/restart

**Solution**: Idempotency keys

```typescript
// First call - creates new tracking number
await trackingNumberManager.createTrackingNumber({
  shipmentId: 'ship-001',
  role: 'RECIPIENT',
  recipientStopId: 'stop-3',
  idempotencyKey: 'ship-001-stop-3', // ← Key prevents duplicates
});

// Second call (after restart) - returns existing
await trackingNumberManager.createTrackingNumber({
  shipmentId: 'ship-001',
  role: 'RECIPIENT',
  recipientStopId: 'stop-3',
  idempotencyKey: 'ship-001-stop-3', // ← Same key
});
// ✅ Returns existing tracking number, does NOT create duplicate
```

### Usage Examples

#### Create Tracking Numbers

```typescript
import { trackingNumberManager } from './services/trackingNumberManager';

// Create supplier tracking number
const supplierTracking = await trackingNumberManager.createTrackingNumber({
  shipmentId: 'ship-001',
  role: 'SUPPLIER',
  idempotencyKey: 'ship-001-supplier', // Prevents duplicates
});

// Create recipient tracking numbers (one per stop)
const recipientStopIds = ['stop-1', 'stop-2', 'stop-3'];
const recipientTrackings = await trackingNumberManager.createRecipientTrackingNumbers(
  'ship-001',
  recipientStopIds
);

// Create manager tracking number
const managerTracking = await trackingNumberManager.createTrackingNumber({
  shipmentId: 'ship-001',
  role: 'MANAGER',
  idempotencyKey: 'ship-001-manager',
});
```

#### Validate Tracking Number

```typescript
const isValid = await trackingNumberManager.isValid('RECV-ABC123-XYZ');
if (isValid) {
  // Allow access
} else {
  // Reject (expired, archived, or revoked)
}
```

#### Archive on Delivery

```typescript
// When shipment is delivered, archive all tracking numbers
await trackingNumberManager.archiveShipmentTrackingNumbers('ship-001');
// ✅ All tracking numbers now ARCHIVED, can be reused later
```

#### Reactivate if Needed

```typescript
// If shipment needs to be re-sent
await trackingNumberManager.reactivateTrackingNumber('RECV-ABC123-XYZ');
// ✅ Tracking number back to ACTIVE state
```

---

## 📢 Notification Propagation

### Role-Based Notifications

Different roles receive different information:

#### Supplier Notifications

```typescript
{
  title: "🚛 Long-Haul Route Changed",
  message: "Route updated: Heavy traffic on I-10. 5 stops affected.",
  oldETA: 14:30,
  newETA: 15:15,
  routeSummary: "Now using US-290 bypass"
}
```

#### Recipient Notifications

```typescript
{
  title: "📍 Delivery Position Updated",
  message: "Your delivery position changed from stop 5 to stop 3 due to route optimization.",
  oldPosition: 5,
  newPosition: 3,
  oldETA: 16:45,
  newETA: 15:30
}
```

#### Manager Notifications

```typescript
{
  title: "🤖 Automatic Reroute Applied",
  message: "LAST_MILE_RESEQUENCE: Traffic optimization. 7 stops updated.",
  affectedStops: ["stop-1", "stop-2", ...],
  routeChange: { oldRouteId: "route-1", newRouteId: "route-2" }
}
```

### Notification Channels

Configure per tracking number:

```typescript
import { notificationPropagationService } from './services/notificationPropagationService';

notificationPropagationService.setPreferences('RECV-ABC123-XYZ', {
  trackingNumber: 'RECV-ABC123-XYZ',
  channels: [
    { type: 'IN_APP', enabled: true },
    { type: 'EMAIL', endpoint: 'customer@example.com', enabled: true },
    { type: 'SMS', endpoint: '+1234567890', enabled: false },
    { type: 'WEBHOOK', endpoint: 'https://api.example.com/webhook', enabled: true },
  ],
  receiveRerouteAlerts: true,
  receiveETAUpdates: true,
  receiveSequenceChanges: true,
});
```

### Real-Time Subscriptions

#### In React Component

```typescript
import { notificationPropagationService } from '../services/notificationPropagationService';

useEffect(() => {
  const unsubscribe = notificationPropagationService.subscribe(
    trackingNumber,
    (notification) => {
      // Update UI
      setNotifications(prev => [notification, ...prev]);
      
      // Show toast
      toast.info(notification.notification.title);
    }
  );

  return unsubscribe;
}, [trackingNumber]);
```

---

## 🗄️ Database Design

### Key Tables

#### `tracking_numbers` (Enhanced)

```sql
CREATE TABLE tracking_numbers (
    id UUID PRIMARY KEY,
    tracking_number VARCHAR(50) UNIQUE NOT NULL,
    shipment_id UUID REFERENCES shipments(id),
    role VARCHAR(50) NOT NULL, -- SUPPLIER, RECIPIENT, MANAGER
    recipient_stop_id UUID REFERENCES stops(id),
    
    -- Lifecycle management
    status VARCHAR(50) DEFAULT 'ACTIVE', -- ACTIVE, EXPIRED, ARCHIVED, REVOKED
    archived_at TIMESTAMP,
    revoked_at TIMESTAMP,
    revoked_reason TEXT,
    
    -- Idempotency
    idempotency_key VARCHAR(255),
    
    -- Expiration
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
);

CREATE INDEX idx_tracking_idempotency ON tracking_numbers(idempotency_key);
CREATE INDEX idx_tracking_status ON tracking_numbers(status);
```

#### `shipment_lifecycle_history` (New)

Tracks every state change of a shipment:

```sql
CREATE TABLE shipment_lifecycle_history (
    id UUID PRIMARY KEY,
    shipment_id UUID REFERENCES shipments(id),
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    old_leg_index INTEGER,
    new_leg_index INTEGER,
    triggered_by VARCHAR(50), -- SYSTEM, MANAGER, AUTOMATIC_REROUTE
    trigger_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `route_history` (New)

Complete audit trail of all routes:

```sql
CREATE TABLE route_history (
    id UUID PRIMARY KEY,
    shipment_id UUID REFERENCES shipments(id),
    route_type VARCHAR(50), -- LONG_HAUL, LAST_MILE
    route_snapshot JSONB, -- Complete route data
    planned_distance_miles DECIMAL(10, 2),
    actual_distance_miles DECIMAL(10, 2),
    change_reason TEXT,
    was_reroute BOOLEAN,
    reroute_event_id UUID REFERENCES reroute_events(id),
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

#### `eta_history` (New)

Tracks prediction accuracy:

```sql
CREATE TABLE eta_history (
    id UUID PRIMARY KEY,
    shipment_id UUID REFERENCES shipments(id),
    stop_id UUID REFERENCES stops(id),
    predicted_eta TIMESTAMP,
    actual_eta TIMESTAMP,
    prediction_method VARCHAR(50), -- ML_MODEL, SIMPLE_CALC, HYBRID
    confidence_score DECIMAL(3, 2),
    prediction_error_minutes INTEGER
);
```

### Migration

Run the migration:

```bash
psql -U postgres -d logistics_b2b -f database/migrations/001_tracking_number_lifecycle.sql
```

Verify:

```sql
-- Check new columns
\d tracking_numbers

-- Check new tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('shipment_lifecycle_history', 'route_history', 'eta_history');

-- Test functions
SELECT can_reuse_tracking_number('RECV-ABC123-XYZ');
```

---

## 🔌 API Endpoints

### Supplier Endpoints

#### `GET /api/supplier/dashboard?trackingNumber=SUPP-XXX`

Returns supplier dashboard with all shipments.

**Response:**
```json
{
  "shipments": [
    {
      "shipmentId": "ship-001",
      "status": "IN_TRANSIT_LONG_HAUL",
      "currentETA": 1700000000000,
      "previousETA": 1700003600000,
      "routeSummary": "I-10 East via Houston",
      "progress": 45
    }
  ],
  "summary": {
    "totalShipments": 10,
    "inTransit": 7,
    "delivered": 2,
    "delayed": 1
  },
  "recentReroutes": [...]
}
```

#### `GET /api/supplier/shipment/:shipmentId`

Get detailed shipment info.

### Receiver Endpoints

#### `GET /api/receiver/track/:trackingNumber`

Track delivery status for a recipient.

**Response:**
```json
{
  "shipmentId": "ship-001",
  "status": "IN_TRANSIT_LAST_MILE",
  "deliveryPosition": 3,
  "totalStops": 7,
  "myETA": 1700000000000,
  "myStop": {
    "name": "123 Main St",
    "estimatedArrival": 1700000000000
  },
  "notifications": [
    {
      "type": "SEQUENCE_CHANGE",
      "title": "Delivery Position Updated",
      "message": "You are now stop 3 of 7",
      "timestamp": "2025-11-16T10:30:00Z"
    }
  ]
}
```

#### `GET /api/receiver/delivery-window/:trackingNumber`

Get estimated delivery window.

**Response:**
```json
{
  "earliest": 1700000000000,
  "latest": 1700003600000,
  "confidence": 0.85
}
```

### Manager Endpoints

#### `GET /api/manager/shipments?trackingNumber=MGR-XXX`

Get all shipments (manager view).

#### `GET /api/manager/shipment/:shipmentId/tracking-numbers`

Get all tracking numbers for a shipment.

**Response:**
```json
{
  "supplier": ["SUPP-ABC123-XYZ"],
  "recipients": [
    { "trackingNumber": "RECV-DEF456-ABC", "stopName": "Stop 1", "status": "ACTIVE" },
    { "trackingNumber": "RECV-GHI789-DEF", "stopName": "Stop 2", "status": "ACTIVE" }
  ],
  "manager": ["MGR-JKL012-GHI"]
}
```

---

## 🔧 Integration Guide

### Step 1: Initialize on App Startup

```typescript
// In your app.ts or main.ts
import { eventNotificationIntegration } from './services/eventNotificationIntegration';

// Initialize integration
eventNotificationIntegration.initialize();
```

### Step 2: Setup API Routes

```typescript
import { apiRouter } from './services/stakeholderAPI';
import express from 'express';

const app = express();

// Setup all stakeholder routes
apiRouter.setupRoutes(app);

app.listen(3000);
```

### Step 3: Wire Manager Dashboard

```typescript
import { rerouteEventBus, RerouteEvent } from './services/rerouteEventBus';

function handleManagerApproveReroute(shipmentId: string, newRouteId: string) {
  const event: RerouteEvent = {
    eventId: `evt-${Date.now()}`,
    timestamp: new Date(),
    shipmentId,
    eventType: 'ROUTE_SWITCH',
    changes: {
      affectedStops: affectedStopIds,
      oldETAs: calculateOldETAs(),
      newETAs: calculateNewETAs(newRouteId),
      reason: 'Manager approved alternative route',
      routeChange: { oldRouteId: currentRouteId, newRouteId },
    },
    triggeredBy: 'MANAGER',
  };

  // Publish event → automatically notifies all stakeholders
  await rerouteEventBus.publish(event);
}
```

### Step 4: Display Notifications in UI

#### Supplier Dashboard

```typescript
import { supplierAPI } from '../services/stakeholderAPI';

const SupplierDashboard = () => {
  const [data, setData] = useState<SupplierDashboardData>();

  useEffect(() => {
    // Fetch initial data
    supplierAPI.getDashboard(trackingNumber).then(setData);

    // Subscribe to real-time updates
    const unsubscribe = supplierAPI.subscribeToUpdates(
      trackingNumber,
      (update) => {
        // Update shipment in state
        setData(prev => ({
          ...prev,
          shipments: prev.shipments.map(s => 
            s.shipmentId === update.shipmentId ? update : s
          )
        }));
      }
    );

    return unsubscribe;
  }, [trackingNumber]);

  return <div>{/* Render dashboard */}</div>;
};
```

#### Receiver Tracking

```typescript
import { receiverAPI } from '../services/stakeholderAPI';

const ReceiverTracking = () => {
  const [trackingData, setTrackingData] = useState<ReceiverTrackingData>();

  useEffect(() => {
    // Fetch tracking data
    receiverAPI.getTrackingData(trackingNumber).then(setTrackingData);

    // Subscribe to updates
    const unsubscribe = receiverAPI.subscribeToUpdates(
      trackingNumber,
      setTrackingData
    );

    return unsubscribe;
  }, [trackingNumber]);

  return (
    <div>
      <p>Delivery Position: {trackingData?.deliveryPosition} of {trackingData?.totalStops}</p>
      <p>ETA: {new Date(trackingData?.myETA).toLocaleString()}</p>
      {trackingData?.optimizationMessage && (
        <Alert>{trackingData.optimizationMessage}</Alert>
      )}
    </div>
  );
};
```

---

## 🧪 Testing

### Test 1: Tracking Number Lifecycle

```typescript
import { trackingNumberManager } from './services/trackingNumberManager';

// Create tracking number
const tracking1 = await trackingNumberManager.createTrackingNumber({
  shipmentId: 'test-ship-001',
  role: 'RECIPIENT',
  recipientStopId: 'test-stop-1',
  idempotencyKey: 'test-001',
});
console.log('Created:', tracking1.trackingNumber);

// Try to create again (should return same)
const tracking2 = await trackingNumberManager.createTrackingNumber({
  shipmentId: 'test-ship-001',
  role: 'RECIPIENT',
  recipientStopId: 'test-stop-1',
  idempotencyKey: 'test-001', // Same key
});
console.log('Duplicate prevented:', tracking1.trackingNumber === tracking2.trackingNumber);

// Archive
await trackingNumberManager.archiveTrackingNumber(tracking1.trackingNumber);
console.log('Archived');

// Reactivate
await trackingNumberManager.reactivateTrackingNumber(tracking1.trackingNumber);
console.log('Reactivated');
```

### Test 2: Notification Propagation

```typescript
import { eventNotificationIntegration } from './services/eventNotificationIntegration';

// Initialize
eventNotificationIntegration.initialize();

// Trigger test reroute
await eventNotificationIntegration.triggerTestReroute('test-ship-001');

// Check notifications
const notifications = notificationPropagationService.getUnreadNotifications('RECV-ABC-123');
console.log('Notifications received:', notifications.length);
```

### Test 3: API Endpoints

```bash
# Supplier dashboard
curl http://localhost:3000/api/supplier/dashboard?trackingNumber=SUPP-ABC123-XYZ

# Receiver tracking
curl http://localhost:3000/api/receiver/track/RECV-DEF456-ABC

# Delivery window
curl http://localhost:3000/api/receiver/delivery-window/RECV-DEF456-ABC
```

---

## 🔍 Troubleshooting

### Problem: Tracking number cannot be reused

**Symptom**: Error "Tracking number already exists"

**Solution**:
```sql
-- Check status
SELECT status FROM tracking_numbers WHERE tracking_number = 'RECV-XXX';

-- If ACTIVE, archive first
SELECT archive_tracking_number('RECV-XXX');

-- Now can reuse
SELECT can_reuse_tracking_number('RECV-XXX'); -- Returns true
```

### Problem: Notifications not received

**Checklist**:
1. Is integration initialized? Check `eventNotificationIntegration.initialize()` called
2. Are tracking numbers active? Query `tracking_numbers` table
3. Check event bus subscriptions: `rerouteEventBus` should have listeners
4. Check logs for errors in notification delivery

**Debug**:
```typescript
// Enable verbose logging
rerouteEventBus.subscribe('*', (event) => {
  console.log('Event received:', event);
});

notificationPropagationService.subscribe('RECV-XXX', (notif) => {
  console.log('Notification delivered:', notif);
});
```

### Problem: Database migration fails

**Common issues**:
- Missing UUID extension: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`
- Table already exists: Check if migration already ran
- Permission denied: Use superuser or grant permissions

**Verify migration**:
```sql
-- Check tracking_numbers has new columns
\d tracking_numbers

-- Should see: status, archived_at, revoked_at, idempotency_key

-- Check new tables exist
\dt *history*

-- Should see: shipment_lifecycle_history, route_history, eta_history
```

---

## 📊 Success Metrics

After implementation, you should have:

- ✅ **Zero duplicate tracking numbers** (idempotency works)
- ✅ **100% notification delivery rate** to active tracking numbers
- ✅ **< 1 second** notification propagation time
- ✅ **Tracking numbers survive system restart** (soft delete pattern)
- ✅ **Complete audit trail** in history tables
- ✅ **Role-specific notifications** formatted correctly

---

## 🚀 Next Steps

1. **Deploy database migration**
   ```bash
   psql -U postgres -d logistics_b2b -f database/migrations/001_tracking_number_lifecycle.sql
   ```

2. **Initialize integration in app**
   ```typescript
   eventNotificationIntegration.initialize();
   ```

3. **Setup API routes**
   ```typescript
   apiRouter.setupRoutes(app);
   ```

4. **Update UI components** to subscribe to notifications

5. **Test end-to-end flow**
   - Create shipment with tracking numbers
   - Trigger reroute from manager dashboard
   - Verify all stakeholders notified
   - Check database history tables

6. **Configure notification channels**
   - Setup email service (SendGrid/SES)
   - Setup SMS service (Twilio/SNS)
   - Configure webhooks for external systems

---

**Questions?** Check the inline documentation in each service file or refer to the main `REROUTING_ENGINE_ARCHITECTURE.md` guide.
