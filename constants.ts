

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
    { id: 'item-mattress', contents: 'Mattresses', quantity: 10, destinationStopId: 'stop-beaumont-downtown' },
    { id: 'item-medical', contents: 'Medical Equipment Kits', quantity: 6, destinationStopId: 'stop-beaumont-medical' },
    { id: 'item-grocery', contents: 'Grocery Pallets', quantity: 8, destinationStopId: 'stop-nederland-market' },
    { id: 'item-industrial-tools', contents: 'Industrial Tools & Fasteners', quantity: 12, destinationStopId: 'stop-port-arthur-shipyard' },
    { id: 'item-hvac', contents: 'HVAC Units', quantity: 4, destinationStopId: 'stop-bridge-city' },
    { id: 'item-lubricant', contents: 'Lubricant Drums', quantity: 10, destinationStopId: 'stop-groves' },
    { id: 'item-ecommerce', contents: 'E-commerce Parcels', quantity: 40, destinationStopId: 'stop-midcounty' },
    { id: 'item-clinic', contents: 'Clinic Supplies', quantity: 7, destinationStopId: 'stop-vidor' },
    { id: 'item-home', contents: 'Home Improvement Goods', quantity: 9, destinationStopId: 'stop-silsbee' },
    { id: 'item-retail-fixtures', contents: 'Retail Fixtures', quantity: 5, destinationStopId: 'stop-lumberton' },
  ],
  origin: { id: 'stop-origin-beaumont', name: 'Beaumont Distribution Center (Inbound)', location: [30.0833, -94.1250], status: 'Completed' },
  longHaulStops: [],
  hub: { id: 'stop-hub-beaumont', name: 'Beaumont Cross-Dock Hub', location: [30.0833, -94.1250], status: 'Pending' },
  lastMileStops: [
    { id: 'stop-beaumont-downtown', name: 'Downtown Beaumont Retail', location: [30.0869, -94.1018], status: 'Pending', unloadingTimeMinutes: 20 },
    { id: 'stop-beaumont-medical', name: 'Beaumont Medical Center', location: [30.0292, -94.1300], status: 'Pending', unloadingTimeMinutes: 25 },
    { id: 'stop-nederland-market', name: 'Nederland Fresh Market', location: [29.9739, -94.0021], status: 'Pending', unloadingTimeMinutes: 30 },
    { id: 'stop-port-arthur-shipyard', name: 'Port Arthur Shipyard Supply', location: [29.8840, -93.9390], status: 'Pending', unloadingTimeMinutes: 35 },
    { id: 'stop-bridge-city', name: 'Bridge City Hardware', location: [30.0274, -93.8451], status: 'Pending', unloadingTimeMinutes: 40 },
    { id: 'stop-groves', name: 'Groves Industrial Park', location: [29.9483, -93.9170], status: 'Pending', unloadingTimeMinutes: 15 },
    { id: 'stop-midcounty', name: 'Mid-County Logistics Depot', location: [29.9688, -94.0820], status: 'Pending', unloadingTimeMinutes: 20 },
    { id: 'stop-vidor', name: 'Vidor Community Clinic', location: [30.1311, -94.0158], status: 'Pending', unloadingTimeMinutes: 18 },
    { id: 'stop-silsbee', name: 'Silsbee Home Store', location: [30.3491, -94.1777], status: 'Pending', unloadingTimeMinutes: 22 },
    { id: 'stop-lumberton', name: 'Lumberton Distribution Outlet', location: [30.2650, -94.1990], status: 'Pending', unloadingTimeMinutes: 28 },
  ],
  status: ShipmentStatus.PENDING,
  currentLegIndex: 0, // 0 == hub -> first last-mile stop
};