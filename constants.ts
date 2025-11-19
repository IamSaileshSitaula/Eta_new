

import { Shipment, ShipmentStatus, UserRole } from './types';

export const SIMULATION_SPEED_MPH = 60;
export const SIMULATION_INTERVAL_MS = 60000; // 60 seconds - synchronized with API updates

// ============================================================================
// TRACKING NUMBERS - Now managed by database (see database/schema.sql)
// This is kept for backward compatibility during migration
// TODO: Remove after full database migration is complete
// ============================================================================
export const TRACKING_NUMBERS: { [key: string]: { role: UserRole; shipmentId: string; recipientStopId?: string } } = {
  'SUPPLIER123': { role: UserRole.SUPPLIER, shipmentId: 'SHIP001' },
  'SUPER8-456': { role: UserRole.RECIPIENT, shipmentId: 'SHIP001', recipientStopId: 'stop-2' },
  'MANAGER789': { role: UserRole.MANAGER, shipmentId: 'SHIP001' },
};

// ============================================================================
// ROUTES - REMOVED - Now dynamically generated via multiRouteService.ts
// ============================================================================
// Hardcoded routes have been replaced with dynamic route generation:
// - Long-haul routes: Generated via generateAlternativeRoutes() using OSRM API
// - Last-mile routes: Optimized via optimizeStopSequence() using ML backend
// 
// To get routes, use:
//   import { generateAlternativeRoutes } from './services/multiRouteService';
//   const result = await generateAlternativeRoutes(origin, destination);
// ============================================================================

// Initial Shipment Data
export const INITIAL_SHIPMENT: Shipment = {
  trackingNumber: 'SHIP001',
  shipmentItems: [
    { id: 'item-mattress', contents: 'Mattresses', quantity: 10, destinationStopId: 'stop-2' },
    { id: 'item-wine', contents: 'Cases of Wine', quantity: 5, destinationStopId: 'stop-liquor' },
  ],
  origin: { id: 'stop-0', name: 'Manufacturer, Austin, TX', location: [30.2672, -97.7431], status: 'Completed' },
  longHaulStops: [],
  hub: { id: 'stop-1', name: 'Distribution Hub, Beaumont, TX', location: [30.0833, -94.1250], status: 'Pending' },
  lastMileStops: [
    { id: 'stop-gas', name: 'Gas Station', location: [29.9980, -94.0900], status: 'Pending' },
    { id: 'stop-2', name: 'Super 8, Port Arthur', location: [29.9500, -94.0000], status: 'Pending' },
    { id: 'stop-liquor', name: 'Liquor Store', location: [29.9900, -93.9200], status: 'Pending' },
  ],
  status: ShipmentStatus.PENDING,
  currentLegIndex: 0, // 0 is Austin->Beaumont
};