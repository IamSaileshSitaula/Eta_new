

import { Shipment, Coordinates, Route, UserRole, ShipmentStatus } from './types';

export const SIMULATION_SPEED_MPH = 60;
export const SIMULATION_INTERVAL_MS = 2000; // Was 30s, sped up for demo

// Tracking numbers mapped to roles and shipment details
export const TRACKING_NUMBERS: { [key: string]: { role: UserRole; shipmentId: string; recipientStopId?: string } } = {
  'SUPPLIER123': { role: UserRole.SUPPLIER, shipmentId: 'SHIP001' },
  'SUPER8-456': { role: UserRole.RECIPIENT, shipmentId: 'SHIP001', recipientStopId: 'stop-2' },
  'MANAGER789': { role: UserRole.MANAGER, shipmentId: 'SHIP001' },
};

// Route Data (Simplified paths for simulation)
// Austin -> Beaumont
const ROUTE_AUSTIN_BEAUMONT: Coordinates[] = [
  [30.2672, -97.7431], [30.2500, -97.7000], [30.2000, -97.5000],
  [30.1500, -97.0000], [30.1000, -96.5000], [30.0800, -96.0000],
  [30.0700, -95.5000], [30.0800, -95.0000], [30.0833, -94.1250]
];

// Beaumont Hub -> Last Mile Loop
const ROUTE_LAST_MILE: Coordinates[] = [
  [30.0833, -94.1250], // Beaumont Hub
  [30.0450, -94.1100], [29.9980, -94.0900], // -> Gas Station
  [29.9800, -94.0500], [29.9500, -94.0000], // -> Super 8
  [29.9700, -93.9500], [29.9900, -93.9200], // -> Liquor Store
  [30.0300, -93.9800], [30.0833, -94.1250]  // -> Back to Hub
];

export const ROUTES: { [key: string]: Route } = {
  'R1': { id: 'R1', path: [...ROUTE_AUSTIN_BEAUMONT] },
  'R2': { id: 'R2', path: [
    ROUTE_AUSTIN_BEAUMONT[ROUTE_AUSTIN_BEAUMONT.length - 1], // Start from hub
    ...ROUTE_LAST_MILE.slice(1) // Append last mile path
  ]},
};

// Initial Shipment Data
export const INITIAL_SHIPMENT: Shipment = {
  trackingNumber: 'SHIP001',
  shipmentItems: [
    { id: 'item-mattress', contents: '10 Mattresses', destinationStopId: 'stop-2' },
    { id: 'item-wine', contents: '5 Cases of Wine', destinationStopId: 'stop-liquor' },
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