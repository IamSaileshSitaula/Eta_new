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
  status: 'Pending' | 'Completed' | 'In Progress';
}

export interface ShipmentItem {
  id: string;
  contents: string;
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
}

export interface Route {
  id: string;
  path: Coordinates[];
}

export interface TrafficData {
  status: 'Light' | 'Moderate' | 'Heavy';
  description: string;
}

export interface WeatherData {
  condition: 'Clear' | 'Rain' | 'Storm';
  description: string;
  temperature: number; // Celsius
}

export interface RerouteSuggestion {
  reason: string;
  newRouteId: string;
  timeSavingsMinutes: number;
  confidence: ConfidenceLevel;
}
