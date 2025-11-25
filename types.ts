export enum UserRole {
  SUPPLIER = 'SUPPLIER',
  RECIPIENT = 'RECIPIENT',
  MANAGER = 'MANAGER',
}

export enum ConfidenceLevel {
  HIGH = 'High',
  MEDIUM = 'Medium',
  LOW = 'Low',
}

export enum ShipmentStatus {
  PENDING = 'Pending',
  IN_TRANSIT_LONG_HAUL = 'In Transit (Long Haul)',
  AT_HUB = 'At Distribution Hub',
  IN_TRANSIT_LAST_MILE = 'In Transit (Last Mile)',
  DELIVERED = 'Delivered',
  DELAYED = 'Delayed',
}

export type Coordinates = [number, number];

export interface Stop {
  id: string;
  name: string;
  location: Coordinates;
  status: 'Pending' | 'Completed' | 'In Progress' | 'Unloading';
  unloadingTimeMinutes?: number; // Estimated time to unload at this stop
}

export interface ShipmentItem {
  id: string;
  contents: string;
  quantity: number;
  destinationStopId: string;
}

export interface Shipment {
  trackingNumber: string;
  shipmentItems: ShipmentItem[];
  origin: Stop;
  longHaulStops: Stop[];
  hub: Stop;
  lastMileStops: Stop[];
  status: ShipmentStatus;
  currentLegIndex: number; // 0 for origin->hub, 1+ for last mile stops
  currentLocation?: Coordinates;
  currentEta?: string; // ISO Date string
}

export interface Route {
  id: string;
  path: Coordinates[];
}

export interface TrafficData {
  status: 'Light' | 'Moderate' | 'Heavy';
  description: string;
  currentSpeed?: number;      // Current speed in mph (from TomTom)
  normalSpeed?: number;        // Normal/free-flow speed in mph
  speedFactor?: number;        // Ratio of current/normal (0-1)
  delaySeconds?: number;       // Delay in seconds for this segment
}

export interface WeatherData {
  condition: 'Clear' | 'Rain' | 'Storm';
  description: string;
  temperature: number; // Celsius
}

// ❌ DEPRECATED: Use RerouteEvaluation from useReroutingEngine instead
// This type is kept for backward compatibility but should not be used in new code
// @deprecated - Will be removed in next version
export interface RerouteSuggestion {
  reason: string;
  newRouteId: string;
  timeSavingsMinutes: number;
  confidence: ConfidenceLevel;
}
