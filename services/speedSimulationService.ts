import { Coordinates, TrafficData, WeatherData } from '../types';
import { getWeatherSpeedMultiplier } from './weatherService';
import { getTrafficSpeedMultiplier } from './trafficService';

export type RoadType = 'highway' | 'arterial' | 'residential' | 'city';

export interface RoadSegment {
  start: Coordinates;
  end: Coordinates;
  speedLimitMph: number;
  roadType: RoadType;
  distance: number; // miles
  hasTrafficSignal: boolean;
}

export interface SpeedCalculation {
  baseSpeedMph: number; // Speed limit
  driverSpeedMph: number; // What driver would go (95-100% of limit)
  adjustedSpeedMph: number; // Final speed with all factors
  shouldStop: boolean;
  stopDuration: number; // seconds
  stopReason: 'traffic_light' | 'stop_sign' | 'traffic_congestion' | null;
}

/**
 * Calculate distance between two coordinates using Haversine formula
 */
const getDistance = (coord1: Coordinates, coord2: Coordinates): number => {
  const R = 3958.8; // Radius of Earth in miles
  const lat1 = coord1[0] * (Math.PI / 180);
  const lat2 = coord2[0] * (Math.PI / 180);
  const diffLat = lat2 - lat1;
  const diffLon = (coord2[1] - coord1[1]) * (Math.PI / 180);
  
  const a = Math.sin(diffLat / 2) * Math.sin(diffLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(diffLon / 2) * Math.sin(diffLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
};

/**
 * Analyze road segment to determine road type and speed limit
 * Uses segment length and position to infer road characteristics
 */
export const analyzeRoadSegment = (
  start: Coordinates,
  end: Coordinates,
  segmentIndex: number,
  totalSegments: number
): RoadSegment => {
  const distance = getDistance(start, end);
  
  let roadType: RoadType = 'arterial';
  let speedLimitMph = 45;
  let hasTrafficSignal = false;
  
  // Detect highway segments (long, straight segments)
  if (distance > 0.5) {
    roadType = 'highway';
    speedLimitMph = Math.random() > 0.5 ? 70 : 65; // Interstate or state highway
    hasTrafficSignal = false;
  }
  // Detect residential streets (very short segments)
  else if (distance < 0.1) {
    roadType = 'residential';
    speedLimitMph = Math.random() > 0.5 ? 30 : 25;
    hasTrafficSignal = Math.random() < 0.10; // 10% chance of stop sign
  }
  // Detect city streets (medium segments, check if near urban coordinates)
  else if (distance < 0.3) {
    const isUrbanArea = Math.abs(start[0] - 30) < 0.5 && Math.abs(start[1] + 94) < 0.5; // Near destination
    if (isUrbanArea) {
      roadType = 'city';
      speedLimitMph = Math.random() > 0.5 ? 35 : 30;
      hasTrafficSignal = Math.random() < 0.35; // 35% chance of traffic light
    } else {
      roadType = 'arterial';
      speedLimitMph = Math.random() > 0.5 ? 50 : 45;
      hasTrafficSignal = Math.random() < 0.20; // 20% chance
    }
  }
  // Arterial roads (medium-long segments)
  else {
    roadType = 'arterial';
    speedLimitMph = Math.random() > 0.5 ? 55 : 50;
    hasTrafficSignal = Math.random() < 0.25; // 25% chance
  }
  
  return {
    start,
    end,
    speedLimitMph,
    roadType,
    distance,
    hasTrafficSignal
  };
};

/**
 * Calculate realistic driving speed with all factors applied
 */
export const calculateRealisticSpeed = (
  segment: RoadSegment,
  traffic: TrafficData | null,
  weather: WeatherData | null,
  timeSinceLastStop: number // seconds
): SpeedCalculation => {
  // Step 1: Base speed limit
  const baseSpeedMph = segment.speedLimitMph;
  
  // Step 2: Driver behavior (drivers don't always follow speed limit exactly)
  let driverComplianceFactor = 0.95;
  
  switch (segment.roadType) {
    case 'highway':
      driverComplianceFactor = 0.98; // Drivers go closer to limit on highways
      break;
    case 'arterial':
      driverComplianceFactor = 0.96;
      break;
    case 'city':
      driverComplianceFactor = 0.92; // More cautious in city
      break;
    case 'residential':
      driverComplianceFactor = 0.90; // Very cautious in residential
      break;
  }
  
  const driverSpeedMph = baseSpeedMph * driverComplianceFactor;
  
  // Step 3: Apply weather multiplier
  const weatherMultiplier = getWeatherSpeedMultiplier(weather);
  
  // Step 4: Apply traffic multiplier
  const trafficMultiplier = getTrafficSpeedMultiplier(traffic, segment.roadType);
  
  // Step 5: Calculate final adjusted speed
  const adjustedSpeedMph = driverSpeedMph * weatherMultiplier * trafficMultiplier;
  
  // Step 6: Determine if vehicle should stop
  let shouldStop = false;
  let stopDuration = 0;
  let stopReason: SpeedCalculation['stopReason'] = null;
  
  // Check for traffic light stops
  if (segment.hasTrafficSignal && timeSinceLastStop > 45) {
    // 50% chance of catching red light if it's been a while since last stop
    if (Math.random() < 0.50) {
      shouldStop = true;
      stopReason = segment.roadType === 'residential' ? 'stop_sign' : 'traffic_light';
      
      if (stopReason === 'traffic_light') {
        // Red light: 20-75 seconds (varies by intersection)
        stopDuration = 20 + Math.random() * 55;
      } else {
        // Stop sign: 3-8 seconds
        stopDuration = 3 + Math.random() * 5;
      }
    }
  }
  
  // Rush hour increases stop frequency
  const currentHour = new Date().getHours();
  const isRushHour = (currentHour >= 7 && currentHour <= 9) || (currentHour >= 16 && currentHour <= 19);
  
  if (isRushHour && segment.roadType === 'city' && !shouldStop && timeSinceLastStop > 60) {
    // Extra stops during rush hour in city
    if (Math.random() < 0.25) {
      shouldStop = true;
      stopReason = 'traffic_light';
      stopDuration = 35 + Math.random() * 40;
    }
  }
  
  return {
    baseSpeedMph,
    driverSpeedMph,
    adjustedSpeedMph,
    shouldStop,
    stopDuration,
    stopReason
  };
};

/**
 * Acceleration/deceleration simulation
 * Trucks don't instantly reach target speed
 */
export interface AccelerationState {
  currentSpeed: number;
  targetSpeed: number;
  isAccelerating: boolean;
}

/**
 * Calculate new speed considering acceleration/deceleration
 * @param currentSpeed - Current vehicle speed in mph
 * @param targetSpeed - Target speed in mph
 * @param intervalSeconds - Time interval in seconds
 * @returns New speed after acceleration/deceleration
 */
export const applyAcceleration = (
  currentSpeed: number,
  targetSpeed: number,
  intervalSeconds: number
): number => {
  if (Math.abs(currentSpeed - targetSpeed) < 1) {
    return targetSpeed; // Close enough
  }
  
  // Truck acceleration/deceleration rates (mph per second)
  const ACCELERATION_RATE = 3.0; // 0-60 in ~20 seconds
  const DECELERATION_RATE = 5.0; // Can brake faster than accelerate
  
  const maxChange = intervalSeconds * (currentSpeed < targetSpeed ? ACCELERATION_RATE : DECELERATION_RATE);
  
  if (currentSpeed < targetSpeed) {
    // Accelerating
    return Math.min(currentSpeed + maxChange, targetSpeed);
  } else {
    // Decelerating
    return Math.max(currentSpeed - maxChange, targetSpeed);
  }
};

/**
 * Add realistic speed variation (drivers don't maintain exact constant speed)
 */
export const addSpeedVariation = (speed: number): number => {
  // Add ±3 mph random variation
  const variation = (Math.random() - 0.5) * 6;
  return Math.max(0, speed + variation);
};
