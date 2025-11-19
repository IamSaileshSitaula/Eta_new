/**
 * ❌ DEPRECATED: ML-based Rerouting Service
 * 
 * @deprecated This service is DEPRECATED and will be removed in the next version.
 * 
 * REASON FOR DEPRECATION:
 * - Replaced by comprehensive multi-route engine (services/multiRouteService.ts)
 * - Continuous evaluation now handled by useReroutingEngine hook (hooks/useReroutingEngine.ts)
 * - Returns old RerouteSuggestion type instead of RerouteEvaluation
 * - No route comparison capabilities
 * - Hardcoded time savings instead of actual calculations
 * 
 * MIGRATION GUIDE:
 * ❌ OLD (Deprecated):
 *   import { getMLRerouteSuggestion } from './services/mlReroutingService';
 *   const suggestion = await getMLRerouteSuggestion(request);
 * 
 * ✅ NEW (Recommended):
 *   import { useReroutingEngine } from './hooks/useReroutingEngine';
 *   const rerouteEval = useReroutingEngine(shipment, truckPosition, currentRoute, role);
 * 
 * The new approach provides:
 * - Continuous evaluation every 2 minutes (vs single call)
 * - ML confidence scoring with 4 factors
 * - Actual route alternatives from OSRM
 * - Real time savings calculations
 * - Historical accuracy tracking
 * 
 * DO NOT USE THIS FILE FOR NEW CODE.
 * 
 * ---
 * 
 * Original Description:
 * Integrates with LaDe (Latent Diffusion ETA) backend trained on Cainiao-AI dataset
 * 
 * The Cainiao-AI/LaDe dataset provides:
 * - Real-world logistics trajectory data
 * - Traffic-aware ETA predictions
 * - Multi-stop route optimization patterns
 * - Weather and time-of-day impacts on delivery times
 * 
 * This service leverages those insights for last-mile route optimization
 */

import { Coordinates, Stop, TrafficData, WeatherData } from '../types';

interface MLRerouteRequest {
  currentLocation: Coordinates;
  remainingStops: Stop[];
  currentTraffic: TrafficData | null;
  currentWeather: WeatherData | null;
  timeOfDay: string;
  dayOfWeek: string;
}

interface MLRerouteResponse {
  optimizedRoute: Stop[];
  predictedETAs: number[]; // ETA to each stop in minutes
  timeSavings: number; // minutes saved vs current route
  confidence: number; // 0-1
  reason: string;
  alternativeRoutes?: {
    route: Stop[];
    etas: number[];
    score: number;
  }[];
}

interface TrajectoryFeature {
  location: Coordinates;
  timestamp: number;
  speed: number;
  trafficLevel: string;
  weatherCondition: string;
}

/**
 * ML Backend API endpoint (to be deployed separately)
 * This would host the LaDe models for ETA prediction and route optimization
 */
const ML_BACKEND_URL = import.meta.env.VITE_ML_BACKEND_URL || 'http://localhost:8000';

/**
 * Get ML-based reroute suggestions for last-mile delivery
 * 
 * @deprecated DO NOT USE - Use useReroutingEngine hook instead
 * @see hooks/useReroutingEngine.ts for the replacement
 */
export async function getMLRerouteSuggestion(
  request: MLRerouteRequest
): Promise<MLRerouteResponse | null> {
  try {
    // Check if ML backend is configured
    if (!ML_BACKEND_URL || ML_BACKEND_URL === 'http://localhost:8000') {
      console.log('🤖 ML Backend not configured, using fallback rerouting');
      return getFallbackReroute(request);
    }

    console.log('🤖 Requesting ML reroute prediction...');

    // Prepare trajectory features for the model
    const trajectoryFeatures: TrajectoryFeature = {
      location: request.currentLocation,
      timestamp: Date.now(),
      speed: request.currentTraffic?.currentSpeed || 30,
      trafficLevel: request.currentTraffic?.status || 'Unknown',
      weatherCondition: request.currentWeather?.condition || 'Clear'
    };

    // Call ML backend for route optimization
    const response = await fetch(`${ML_BACKEND_URL}/api/optimize-route`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        current_location: request.currentLocation,
        stops: request.remainingStops.map(s => ({
          id: s.id,
          location: s.location,
          name: s.name,
          priority: 'high' // All remaining stops are delivery stops
        })),
        trajectory_features: trajectoryFeatures,
        time_of_day: request.timeOfDay,
        day_of_week: request.dayOfWeek,
        traffic_condition: request.currentTraffic,
        weather_condition: request.currentWeather
      })
    });

    if (!response.ok) {
      throw new Error(`ML Backend error: ${response.status}`);
    }

    const mlResult = await response.json();

    console.log('✅ ML reroute prediction received:', mlResult);

    // Transform ML backend response to our format
    const optimizedRoute: Stop[] = mlResult.optimized_stop_order.map((stopId: string) => 
      request.remainingStops.find(s => s.id === stopId)!
    ).filter(Boolean);

    return {
      optimizedRoute,
      predictedETAs: mlResult.predicted_etas,
      timeSavings: mlResult.time_savings_minutes,
      confidence: mlResult.confidence,
      reason: mlResult.reasoning || 'ML model suggests route optimization based on traffic and delivery patterns',
      alternativeRoutes: mlResult.alternative_routes?.map((alt: any) => ({
        route: alt.stop_order.map((id: string) => 
          request.remainingStops.find(s => s.id === id)!
        ).filter(Boolean),
        etas: alt.etas,
        score: alt.score
      }))
    };

  } catch (error) {
    console.error('❌ ML rerouting error:', error);
    return getFallbackReroute(request);
  }
}

/**
 * Fallback heuristic-based rerouting when ML backend is unavailable
 * Uses nearest neighbor + traffic awareness
 */
function getFallbackReroute(request: MLRerouteRequest): MLRerouteResponse | null {
  if (request.remainingStops.length <= 2) {
    return null; // Not worth rerouting with so few stops
  }

  console.log('🔄 Using fallback heuristic rerouting');

  // Simple nearest-neighbor with traffic penalty
  const currentLoc = request.currentLocation;
  const unvisited = [...request.remainingStops];
  const optimizedRoute: Stop[] = [];
  let currentPos = currentLoc;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minCost = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const stop = unvisited[i];
      const distance = getDistance(currentPos, stop.location);
      
      // Add traffic penalty
      const trafficMultiplier = request.currentTraffic?.status === 'Heavy' ? 1.5 : 
                               request.currentTraffic?.status === 'Moderate' ? 1.2 : 1.0;
      
      // All stops are delivery stops, no priority differentiation needed
      const cost = distance * trafficMultiplier;
      
      if (cost < minCost) {
        minCost = cost;
        nearestIdx = i;
      }
    }

    const nextStop = unvisited.splice(nearestIdx, 1)[0];
    optimizedRoute.push(nextStop);
    currentPos = nextStop.location;
  }

  // Check if route is different from original
  const isDifferent = optimizedRoute.some((stop, idx) => 
    stop.id !== request.remainingStops[idx]?.id
  );

  if (!isDifferent) {
    return null; // No improvement found
  }

  // Estimate time savings (rough heuristic)
  const originalDistance = calculateTotalDistance(currentLoc, request.remainingStops);
  const optimizedDistance = calculateTotalDistance(currentLoc, optimizedRoute);
  const distanceSaved = originalDistance - optimizedDistance;
  const timeSavings = Math.round((distanceSaved / 40) * 60); // Assume 40 mph average

  if (timeSavings < 5) {
    return null; // Not worth it for less than 5 minutes
  }

  return {
    optimizedRoute,
    predictedETAs: optimizedRoute.map((_, idx) => (idx + 1) * 15), // Rough estimate
    timeSavings,
    confidence: 0.7,
    reason: `Optimized route based on proximity and current ${request.currentTraffic?.status || 'traffic'} conditions. Estimated ${timeSavings} min savings.`
  };
}

/**
 * Calculate total route distance
 */
function calculateTotalDistance(start: Coordinates, stops: Stop[]): number {
  let total = 0;
  let current = start;
  
  for (const stop of stops) {
    total += getDistance(current, stop.location);
    current = stop.location;
  }
  
  return total;
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function getDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 3959; // Earth's radius in miles
  const lat1 = coord1[0] * Math.PI / 180;
  const lat2 = coord2[0] * Math.PI / 180;
  const deltaLat = (coord2[0] - coord1[0]) * Math.PI / 180;
  const deltaLon = (coord2[1] - coord1[1]) * Math.PI / 180;

  const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

/**
 * Check if rerouting should be triggered based on current conditions
 * 
 * @deprecated DO NOT USE - Use useReroutingEngine hook instead
 * @see hooks/useReroutingEngine.ts for continuous evaluation with ML confidence
 */
export function shouldTriggerRerouting(
  traffic: TrafficData | null,
  weather: WeatherData | null,
  remainingStops: number,
  currentSpeed: number,
  expectedSpeed: number
): boolean {
  // Only consider rerouting for last-mile (multiple remaining stops)
  if (remainingStops < 3) {
    return false;
  }

  // Trigger if traffic is heavy
  if (traffic?.status === 'Heavy') {
    return true;
  }

  // Trigger if current speed is significantly below expected (more than 30% slower)
  if (currentSpeed > 0 && expectedSpeed > 0 && currentSpeed < expectedSpeed * 0.7) {
    return true;
  }

  // Trigger if severe weather
  if (weather?.condition === 'Storm') {
    return true;
  }

  return false;
}
