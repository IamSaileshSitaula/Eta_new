# Quick Reference: Stakeholder Notification System

## 🚀 Quick Start

### 1. Initialize (One-time setup)

```typescript
// In app.ts or main.ts
import { eventNotificationIntegration } from './services/eventNotificationIntegration';

eventNotificationIntegration.initialize();
```

### 2. Trigger Reroute from Manager Dashboard

```typescript
import { rerouteEventBus, RerouteEvent } from './services/rerouteEventBus';

const event: RerouteEvent = {
  eventId: `evt-${Date.now()}`,
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

await rerouteEventBus.publishRerouteEvent(event);
// → Automatically notifies ALL stakeholders
```

### 3. Subscribe to Updates (UI)

**Receiver View:**
```typescript
import { receiverAPI } from '../services/stakeholderAPI';

useEffect(() => {
  const unsubscribe = receiverAPI.subscribeToUpdates(
    trackingNumber,
    (update) => {
      setTrackingData(update);
      toast.info(`Delivery updated: Stop ${update.deliveryPosition} of ${update.totalStops}`);
    }
  );
  return unsubscribe;
}, [trackingNumber]);
```

**Supplier View:**
```typescript
import { supplierAPI } from '../services/stakeholderAPI';

useEffect(() => {
  const unsubscribe = supplierAPI.subscribeToUpdates(
    trackingNumber,
    (update) => {
      updateShipment(update);
    }
  );
  return unsubscribe;
}, [trackingNumber]);
```

## 📊 System Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│           MANAGER DASHBOARD                             │
│  (User approves reroute or auto-reroute triggered)     │
└───────────────────┬─────────────────────────────────────┘
                    │
                    │ publishRerouteEvent(event)
                    ▼
        ┌───────────────────────────┐
        │   REROUTE EVENT BUS       │
        │  (rerouteEventBus.ts)     │
        └───────────┬───────────────┘
                    │
                    │ Event published to all subscribers
                    │
        ┌───────────┴────────────┬──────────────────┐
        │                        │                  │
        ▼                        ▼                  ▼
┌───────────────┐    ┌──────────────────┐   ┌─────────────┐
│ Notification  │    │    Integration   │   │  Database   │
│ Propagation   │    │      Layer       │   │  Updates    │
│   Service     │    │                  │   │             │
└───────┬───────┘    └──────────────────┘   └─────────────┘
        │
        │ 1. Fetch tracking numbers
        │    for shipment
        │
        ▼
┌───────────────────────────┐
│ TRACKING NUMBER MANAGER   │
│ Returns: SUPP-XXX,        │
│          RECV-YYY (x5),   │
│          MGR-ZZZ          │
└───────────┬───────────────┘
            │
            │ 2. Generate notifications
            │    for each role
            │
            ├──────────────┬──────────────┬─────────────┐
            ▼              ▼              ▼             ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐  ┌──────────┐
    │ Supplier │   │ Receiver │   │ Receiver │  │ Manager  │
    │ Portal   │   │ Track #1 │   │ Track #2 │  │Dashboard │
    └──────────┘   └──────────┘   └──────────┘  └──────────┘
         │              │              │              │
         │ "Route      │ "Position    │ "Position    │ "Reroute
         │  changed:   │  changed:    │  unchanged:  │  applied:
         │  I-10 via   │  Stop 5→3"   │  ETA +10min" │  7 stops"
         │  Houston"   │              │              │
         │              │              │              │
         ▼              ▼              ▼              ▼
    Real-time UI updates via subscriptions
```

## 🔑 Tracking Number Lifecycle

```
CREATE with idempotency key
         ↓
    ┌────────────┐
    │   ACTIVE   │ ◄──── Default state when created
    └─────┬──────┘
          │
          ├───────────────────────────────┐
          │                               │
          │ Expiration date passed        │ Manual revoke
          ▼                               ▼
    ┌───────────┐                   ┌───────────┐
    │  EXPIRED  │                   │  REVOKED  │
    └─────┬─────┘                   └───────────┘
          │                               │
          │                               │ Cannot reactivate
          │ Archive                       │
          ▼                               ▼
    ┌───────────┐                      (End)
    │ ARCHIVED  │ ◄──── Soft delete on delivery
    └─────┬─────┘
          │
          │ Reactivate
          │ (if needed)
          │
          ▼
    ┌────────────┐
    │   ACTIVE   │ ◄──── Back to active
    └────────────┘
```

## 🗄️ Database Tables Quick Reference

### Core Tables (Already Existed)
- `shipments` - Main shipment records
- `stops` - All stop locations
- `tracking_numbers` - Role-based tracking (ENHANCED)
- `reroute_events` - Event audit log
- `notifications` - Notification queue

### New Tables (Added)
- `shipment_lifecycle_history` - All state transitions
- `route_history` - All route changes with performance
- `eta_history` - Prediction vs actual tracking

### Key Functions
- `can_reuse_tracking_number(trackingNumber)` → Boolean
- `archive_tracking_number(trackingNumber, reason)` → Void
- `reactivate_tracking_number(trackingNumber)` → Void
- `archive_expired_tracking_numbers()` → Count

## 📡 API Endpoints Quick Reference

### Supplier
- `GET /api/supplier/dashboard?trackingNumber=SUPP-XXX`
- `GET /api/supplier/shipment/:shipmentId`

### Receiver
- `GET /api/receiver/track/:trackingNumber`
- `GET /api/receiver/delivery-window/:trackingNumber`
- `POST /api/receiver/notifications/:id/read`

### Manager
- `GET /api/manager/shipments?trackingNumber=MGR-XXX`
- `GET /api/manager/shipment/:shipmentId/tracking-numbers`

## 🧪 Testing Commands

### Database Migration
```bash
psql -U postgres -d logistics_b2b -f database/migrations/001_tracking_number_lifecycle.sql
```

### Verify Functions
```sql
-- Check if tracking number can be reused
SELECT can_reuse_tracking_number('RECV-ABC-123');

-- Archive a tracking number
SELECT archive_tracking_number('RECV-ABC-123', 'Shipment delivered');

-- Reactivate
SELECT reactivate_tracking_number('RECV-ABC-123');
```

### Test Notification Flow
```typescript
import { eventNotificationIntegration } from './services/eventNotificationIntegration';

eventNotificationIntegration.initialize();
await eventNotificationIntegration.triggerTestReroute('ship-001');
```

## 🔍 Troubleshooting Quick Checks

### Notifications Not Received?
```typescript
// 1. Check integration initialized
eventNotificationIntegration.initialize();

// 2. Check tracking number is active
const isValid = await trackingNumberManager.isValid('RECV-XXX');
console.log('Valid:', isValid);

// 3. Check event bus has listeners
rerouteEventBus.subscribe('*', (event) => {
  console.log('Event:', event);
});
```

### Tracking Number Reuse Issue?
```sql
-- Check status
SELECT tracking_number, status, archived_at 
FROM tracking_numbers 
WHERE tracking_number = 'RECV-XXX';

-- If ACTIVE but should be reused, archive first
SELECT archive_tracking_number('RECV-XXX', 'Manual reset');

-- Then create again (or reactivate)
SELECT reactivate_tracking_number('RECV-XXX');
```

## 📁 File Structure

```
services/
├── rerouteEventBus.ts                    (Already existed)
├── notificationPropagationService.ts     (NEW - 650 lines)
├── trackingNumberManager.ts              (NEW - 550 lines)
├── stakeholderAPI.ts                     (NEW - 600 lines)
└── eventNotificationIntegration.ts       (NEW - 200 lines)

database/
└── migrations/
    └── 001_tracking_number_lifecycle.sql (NEW - 500 lines)

docs/
├── STAKEHOLDER_NOTIFICATION_GUIDE.md     (NEW - 800 lines)
└── IMPLEMENTATION_SUMMARY_NOTIFICATIONS.md (NEW - 600 lines)
```

## ✅ Success Checklist

After deployment, verify:

- [ ] Database migration ran successfully
- [ ] Integration initialized in app.ts
- [ ] API routes configured
- [ ] UI components subscribe to updates
- [ ] Test reroute triggers notifications
- [ ] All roles receive appropriate messages
- [ ] Tracking numbers survive restart
- [ ] Archived numbers can be reactivated
- [ ] No duplicate tracking numbers created

## 🎯 Next Steps

1. Run database migration
2. Initialize integration in app.ts
3. Wire manager dashboard to publish events
4. Update UI components to subscribe
5. Test end-to-end flow
6. Configure notification channels (email, SMS)

---

**Full Documentation**: See `STAKEHOLDER_NOTIFICATION_GUIDE.md`
