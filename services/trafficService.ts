import { Coordinates, TrafficData } from '../types';

const TOMTOM_TRAFFIC_BASE_URL = 'https://api.tomtom.com/traffic/services/4';

interface TomTomTrafficFlowResponse {
  flowSegmentData: {
    frc: string; // Functional Road Class
    currentSpeed: number; // km/h
    freeFlowSpeed: number; // km/h
    currentTravelTime: number; // seconds
    freeFlowTravelTime: number; // seconds
    confidence: number; // 0.0 to 1.0
    roadClosure: boolean;
  };
}

/**
 * Fetch real-time traffic data from TomTom Traffic Flow API
 * @param location - Coordinates [lat, lon]
 * @returns Traffic data including status and description
 */
export const fetchRealTrafficData = async (location: Coordinates): Promise<TrafficData> => {
  const TOMTOM_API_KEY = import.meta.env.VITE_TOMTOM_API_KEY;
  
  console.log('🚦 Traffic API - Key status:', TOMTOM_API_KEY ? 'CONFIGURED' : 'MISSING');
  
  if (!TOMTOM_API_KEY || TOMTOM_API_KEY === 'your_tomtom_api_key_here') {
    throw new Error('TomTom API key not configured');
  }

  const [lat, lon] = location;
  console.log(`🚦 Fetching real traffic data for [${lat}, ${lon}]`);
  
  // TomTom Traffic Flow Segment Data API
  // Using 'relative0' style for speed relative to free-flow, zoom 10 for good detail
  const zoom = 10;
  const url = `${TOMTOM_TRAFFIC_BASE_URL}/flowSegmentData/relative0/${zoom}/json?point=${lat},${lon}&unit=MPH&openLr=false&key=${TOMTOM_API_KEY}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`TomTom API error: ${response.status}`);
  }
  
  const data: TomTomTrafficFlowResponse = await response.json();
  const { currentSpeed, freeFlowSpeed, currentTravelTime, freeFlowTravelTime, roadClosure, confidence } = data.flowSegmentData;
  
  // Convert km/h to mph (TomTom returns km/h even when unit=MPH is specified in some cases)
  const currentSpeedMph = currentSpeed > 200 ? Math.round(currentSpeed * 0.621371) : Math.round(currentSpeed);
  const normalSpeedMph = freeFlowSpeed > 200 ? Math.round(freeFlowSpeed * 0.621371) : Math.round(freeFlowSpeed);
  
  // Calculate traffic level based on speed ratio
  const speedFactor = currentSpeedMph / normalSpeedMph;
  const delaySeconds = currentTravelTime - freeFlowTravelTime;
  
  let status: TrafficData['status'];
  let description: string;
  
  if (roadClosure) {
    status = 'Heavy';
    description = `Road closure detected. Route may be blocked.`;
  } else if (speedFactor >= 0.85) {
    // Traffic is flowing at 85%+ of normal speed
    status = 'Light';
    description = `Traffic is flowing smoothly at ${currentSpeedMph} mph.`;
  } else if (speedFactor >= 0.50) {
    // Traffic is flowing at 50-85% of normal speed
    status = 'Moderate';
    const delayMinutes = Math.round(delaySeconds / 60);
    description = `Moderate congestion. Speed reduced to ${currentSpeedMph} mph (normal: ${normalSpeedMph} mph). ~${delayMinutes} min delay on this segment.`;
  } else {
    // Traffic is flowing at <50% of normal speed
    status = 'Heavy';
    const delayMinutes = Math.round(delaySeconds / 60);
    description = `Heavy traffic. Speed reduced to ${currentSpeedMph} mph (${Math.round(speedFactor * 100)}% of normal). ~${delayMinutes} min delay on this segment.`;
  }
  
  // Add confidence level information
  if (confidence < 0.7) {
    description += ' (Limited traffic data)';
  }
  
  console.log('✅ TomTom traffic data retrieved successfully:', { status, currentSpeedMph, normalSpeedMph });
  
  return {
    status,
    description,
    currentSpeed: currentSpeedMph,
    normalSpeed: normalSpeedMph,
    speedFactor,
    delaySeconds
  };
};

/**
 * Calculate traffic impact multiplier on vehicle speed
 * @param traffic - Current traffic data
 * @param roadType - Type of road (highway, arterial, residential, etc.)
 * @returns Speed multiplier (0.0 to 1.0)
 */
export const getTrafficSpeedMultiplier = (
  traffic: TrafficData | null,
  roadType: 'highway' | 'arterial' | 'residential' | 'city'
): number => {
  if (!traffic) return 1.0;
  
  // Use real speedFactor if available from API
  if (traffic.speedFactor !== undefined) {
    return Math.max(0.2, Math.min(1.0, traffic.speedFactor));
  }
  
  // Traffic affects different road types differently
  switch (traffic.status) {
    case 'Light':
      return 1.0; // 100% normal speed
      
    case 'Moderate':
      if (roadType === 'highway') return 0.70; // 70% on highways
      if (roadType === 'arterial') return 0.60; // 60% on arterials
      if (roadType === 'city') return 0.55; // 55% in city
      return 0.65; // Default 65%
      
    case 'Heavy':
      if (roadType === 'highway') return 0.35; // 35% on highways (stop-and-go)
      if (roadType === 'arterial') return 0.25; // 25% on arterials
      if (roadType === 'city') return 0.20; // 20% in city (gridlock)
      return 0.30; // Default 30%
      
    default:
      return 1.0;
  }
};

/**
 * Get traffic-based delay in minutes for ETA calculation
 * @param traffic - Current traffic data
 * @param distanceMiles - Remaining distance in miles
 * @param roadType - Type of road
 * @returns Estimated delay in minutes
 */
export const getTrafficDelay = (
  traffic: TrafficData | null,
  distanceMiles: number,
  roadType: 'highway' | 'arterial' | 'residential' | 'city' = 'arterial'
): number => {
  if (!traffic || traffic.status === 'Light') return 0;
  
  // If we have real speed data from TomTom Flow Segment API, use it for precise calculation
  if (traffic.currentSpeed && traffic.normalSpeed && traffic.currentSpeed > 0) {
    // Cap the affected distance to 10 miles (assume traffic is local, not entire route)
    const affectedDistance = Math.min(distanceMiles, 10);
    
    const normalTimeMinutes = (affectedDistance / traffic.normalSpeed) * 60;
    const currentTimeMinutes = (affectedDistance / traffic.currentSpeed) * 60;
    return Math.max(0, Math.round(currentTimeMinutes - normalTimeMinutes));
  }
  
  return 0; // No fallback - require real data
};
