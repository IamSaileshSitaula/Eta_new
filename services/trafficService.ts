import { Coordinates, TrafficData } from '../types';

const TOMTOM_API_KEY = (import.meta as any).env?.VITE_TOMTOM_API_KEY;
const TOMTOM_TRAFFIC_BASE_URL = 'https://api.tomtom.com/traffic/services/4';

interface TomTomTrafficFlowResponse {
  flowSegmentData: {
    currentSpeed: number; // km/h
    freeFlowSpeed: number; // km/h
    currentTravelTime: number; // seconds
    freeFlowTravelTime: number; // seconds
    confidence: number; // 0.0 to 1.0
  };
}

/**
 * Fetch real-time traffic data from TomTom Traffic Flow API
 * @param location - Coordinates [lat, lon]
 * @returns Traffic data including status and description
 */
export const fetchRealTrafficData = async (location: Coordinates): Promise<TrafficData> => {
  if (!TOMTOM_API_KEY || TOMTOM_API_KEY === 'your_tomtom_api_key_here') {
    console.warn('TomTom API key not configured. Using mock data.');
    return fetchMockTrafficData();
  }

  try {
    const [lat, lon] = location;
    
    // TomTom Traffic Flow API requires a point and direction
    // We'll query the traffic flow at the current location
    const zoom = 10; // Standard zoom level for traffic
    const url = `${TOMTOM_TRAFFIC_BASE_URL}/flowSegmentData/absolute/${zoom}/json?point=${lat},${lon}&key=${TOMTOM_API_KEY}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`TomTom API error: ${response.status}`);
    }
    
    const data: TomTomTrafficFlowResponse = await response.json();
    
    // Calculate traffic level based on speed ratio
    const speedRatio = data.flowSegmentData.currentSpeed / data.flowSegmentData.freeFlowSpeed;
    const delayRatio = data.flowSegmentData.currentTravelTime / data.flowSegmentData.freeFlowTravelTime;
    
    let status: TrafficData['status'];
    let description: string;
    
    if (speedRatio >= 0.80) {
      // Traffic is flowing at 80%+ of normal speed
      status = 'Light';
      description = `Traffic is flowing smoothly at ${Math.round(data.flowSegmentData.currentSpeed * 0.621371)} mph.`;
    } else if (speedRatio >= 0.50) {
      // Traffic is flowing at 50-80% of normal speed
      status = 'Moderate';
      const currentSpeedMph = Math.round(data.flowSegmentData.currentSpeed * 0.621371);
      const normalSpeedMph = Math.round(data.flowSegmentData.freeFlowSpeed * 0.621371);
      description = `Moderate congestion. Speed reduced to ${currentSpeedMph} mph (normal: ${normalSpeedMph} mph). ${Math.round((delayRatio - 1) * 100)}% slower than usual.`;
    } else {
      // Traffic is flowing at <50% of normal speed
      status = 'Heavy';
      const currentSpeedMph = Math.round(data.flowSegmentData.currentSpeed * 0.621371);
      description = `Heavy traffic congestion. Significant delays - moving at ${currentSpeedMph} mph. Expect ${Math.round((delayRatio - 1) * 100)}% longer travel time.`;
    }
    
    // Add confidence level information
    if (data.flowSegmentData.confidence < 0.7) {
      description += ' (Limited traffic data available)';
    }
    
    return {
      status,
      description
    };
  } catch (error) {
    console.error('Error fetching traffic data:', error);
    return fetchMockTrafficData();
  }
};

/**
 * Fallback mock traffic data when API is unavailable
 */
const fetchMockTrafficData = (): TrafficData => {
  const statuses: TrafficData['status'][] = ['Light', 'Moderate', 'Heavy'];
  const status = statuses[Math.floor(Math.random() * statuses.length)];
  
  let description = 'Traffic is flowing smoothly.';
  if (status === 'Moderate') description = 'Moderate congestion. Minor slowdowns expected.';
  if (status === 'Heavy') description = 'Heavy traffic congestion. Significant delays reported.';
  
  return { status, description };
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
  
  const multiplier = getTrafficSpeedMultiplier(traffic, roadType);
  
  if (multiplier >= 1.0) return 0;
  
  // Calculate additional time due to traffic
  const baseSpeed = roadType === 'highway' ? 65 : roadType === 'city' ? 30 : 45;
  const adjustedSpeed = baseSpeed * multiplier;
  const normalTime = (distanceMiles / baseSpeed) * 60; // minutes
  const adjustedTime = (distanceMiles / adjustedSpeed) * 60;
  
  return Math.round(adjustedTime - normalTime);
};

/**
 * Determine if traffic should cause a complete stop (gridlock)
 * @param traffic - Current traffic data
 * @returns True if vehicle should stop completely
 */
export const shouldStopForTraffic = (traffic: TrafficData | null): boolean => {
  if (!traffic) return false;
  
  // Heavy traffic has chance of complete stops
  if (traffic.status === 'Heavy') {
    return Math.random() < 0.15; // 15% chance of complete stop in heavy traffic
  }
  
  return false;
};

/**
 * Get duration of traffic-related stop in seconds
 * @param traffic - Current traffic data
 * @returns Stop duration in seconds
 */
export const getTrafficStopDuration = (traffic: TrafficData | null): number => {
  if (!traffic || traffic.status !== 'Heavy') return 0;
  
  // Heavy traffic stops: 30 seconds to 3 minutes
  return 30 + Math.random() * 150;
};
