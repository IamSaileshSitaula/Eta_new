/**
 * Multi-Route Generation Service
 * Generates and ranks alternative routes for long-haul segments
 */

import { Coordinates } from '../types';
import { fetchOSRMRoute, EnhancedRouteData } from './osrmService';
import { RoadSegment } from './speedSimulationService';

export interface RouteOption {
  id: string;
  path: Coordinates[];
  segments: RoadSegment[];
  metadata: {
    totalDistanceMiles: number;
    baseETAMinutes: number;
    currentETAMinutes: number;
    tollRoadMiles: number;
    highwayMiles: number;
    avgSpeedLimit: number;
    trafficRiskScore: number;
    weatherRiskScore: number;
    routeType: 'fastest' | 'shortest' | 'balanced' | 'toll-free';
  };
  liveConditions: {
    currentTrafficLevel: 'Light' | 'Moderate' | 'Heavy';
    weatherCondition: string;
    estimatedDelay: number;
    confidence: 'High' | 'Medium' | 'Low';
  };
}

export interface MultiRouteResponse {
  routes: RouteOption[];
  recommended: string;
  comparisonMatrix: {
    fastestRoute: string;
    shortestRoute: string;
    balancedRoute: string;
  };
  generatedAt: Date;
  validUntil: Date;
}

interface OSRMAlternativeResponse {
  code: string;
  routes: Array<{
    geometry: {
      coordinates: number[][];
    };
    duration: number;
    distance: number;
    weight: number;
  }>;
}

/**
 * Fetch alternative routes from OSRM
 */
async function fetchOSRMAlternatives(
  origin: Coordinates,
  destination: Coordinates,
  maxAlternatives: number = 3
): Promise<EnhancedRouteData[]> {
  try {
    const [lat1, lon1] = origin;
    const [lat2, lon2] = destination;
    
    // OSRM format: lon,lat
    const coordString = `${lon1},${lat1};${lon2},${lat2}`;
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?alternatives=${maxAlternatives}&overview=full&geometries=geojson&steps=true&annotations=true`;
    
    const response = await fetch(url);
    if (!response.ok) {
      console.warn('OSRM alternatives failed, using single route');
      return [await fetchOSRMRoute([origin, destination])];
    }
    
    const data: OSRMAlternativeResponse = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      return [await fetchOSRMRoute([origin, destination])];
    }
    
    // Convert each route to our format
    const routes: EnhancedRouteData[] = [];
    for (const route of data.routes) {
      const path: Coordinates[] = route.geometry.coordinates.map(
        coord => [coord[1], coord[0]] as Coordinates
      );
      
      // Analyze segments for each route
      const segments: RoadSegment[] = [];
      const { analyzeRoadSegment } = await import('./speedSimulationService');
      
      for (let i = 0; i < path.length - 1; i++) {
        const segment = analyzeRoadSegment(path[i], path[i + 1], i, path.length - 1);
        segments.push(segment);
      }
      
      routes.push({
        path,
        segments,
        totalDistance: route.distance * 0.000621371, // meters to miles
        baseDuration: route.duration
      });
    }
    
    return routes;
  } catch (error) {
    console.error('Error fetching OSRM alternatives:', error);
    return [await fetchOSRMRoute([origin, destination])];
  }
}

/**
 * Calculate route metadata (tolls, highways, speed limits)
 */
function calculateRouteMetadata(route: EnhancedRouteData): RouteOption['metadata'] {
  const { segments, totalDistance, baseDuration } = route;
  
  let tollRoadMiles = 0;
  let highwayMiles = 0;
  let totalSpeedLimit = 0;
  
  segments.forEach(segment => {
    // Estimate toll roads (highways in certain regions)
    if (segment.roadType === 'highway' && segment.speedLimitMph >= 65) {
      // Rough heuristic: major interstates likely have tolls in some states
      tollRoadMiles += segment.distance * 0.3; // 30% of highways might be toll
    }
    
    if (segment.roadType === 'highway') {
      highwayMiles += segment.distance;
    }
    
    totalSpeedLimit += segment.speedLimitMph * segment.distance;
  });
  
  const avgSpeedLimit = segments.length > 0 
    ? Math.round(totalSpeedLimit / totalDistance) 
    : 60;
  
  // Calculate risk scores (0-1)
  const trafficRiskScore = calculateTrafficRisk(segments);
  const weatherRiskScore = calculateWeatherRisk(segments);
  
  // Classify route type
  const highwayPercentage = highwayMiles / totalDistance;
  const routeType = classifyRouteType(highwayPercentage, totalDistance, baseDuration / 60);
  
  return {
    totalDistanceMiles: totalDistance,
    baseETAMinutes: Math.round(baseDuration / 60),
    currentETAMinutes: Math.round(baseDuration / 60), // Will be updated with live data
    tollRoadMiles: Math.round(tollRoadMiles * 10) / 10,
    highwayMiles: Math.round(highwayMiles * 10) / 10,
    avgSpeedLimit,
    trafficRiskScore,
    weatherRiskScore,
    routeType
  };
}

/**
 * Calculate traffic risk score based on road types
 */
function calculateTrafficRisk(segments: RoadSegment[]): number {
  let riskScore = 0;
  let totalDistance = 0;
  
  segments.forEach(segment => {
    totalDistance += segment.distance;
    
    // City streets have highest traffic risk
    if (segment.roadType === 'city') {
      riskScore += segment.distance * 0.8;
    } else if (segment.roadType === 'arterial') {
      riskScore += segment.distance * 0.5;
    } else if (segment.roadType === 'highway') {
      riskScore += segment.distance * 0.2;
    } else {
      riskScore += segment.distance * 0.1;
    }
  });
  
  return totalDistance > 0 ? Math.min(riskScore / totalDistance, 1.0) : 0.5;
}

/**
 * Calculate weather risk score (exposure to weather)
 */
function calculateWeatherRisk(segments: RoadSegment[]): number {
  // Highway routes have more exposure to weather (less shelter)
  const highwayPercentage = segments.filter(s => s.roadType === 'highway').length / segments.length;
  return highwayPercentage * 0.7; // 0-0.7 range
}

/**
 * Classify route type based on characteristics
 */
function classifyRouteType(
  highwayPercentage: number,
  totalDistance: number,
  baseETAMinutes: number
): 'fastest' | 'shortest' | 'balanced' | 'toll-free' {
  const avgSpeed = totalDistance / (baseETAMinutes / 60);
  
  if (avgSpeed > 55 && highwayPercentage > 0.7) {
    return 'fastest';
  } else if (totalDistance < 100 && highwayPercentage < 0.3) {
    return 'shortest';
  } else if (highwayPercentage < 0.2) {
    return 'toll-free';
  } else {
    return 'balanced';
  }
}

/**
 * Get live traffic and weather conditions for a route
 */
async function getLiveConditions(path: Coordinates[]): Promise<RouteOption['liveConditions']> {
  try {
    // Sample traffic at midpoint of route
    const midpoint = path[Math.floor(path.length / 2)];
    
    const { fetchRealTrafficData } = await import('./trafficService');
    const { fetchRealWeatherData } = await import('./weatherService');
    
    const [traffic, weather] = await Promise.all([
      fetchRealTrafficData(midpoint).catch(() => null),
      fetchRealWeatherData(midpoint).catch(() => null)
    ]);
    
    let estimatedDelay = 0;
    let confidence: 'High' | 'Medium' | 'Low' = 'High';
    
    if (traffic) {
      if (traffic.status === 'Heavy') {
        estimatedDelay += 15;
        confidence = 'Low';
      } else if (traffic.status === 'Moderate') {
        estimatedDelay += 8;
        confidence = 'Medium';
      }
    }
    
    if (weather && weather.condition !== 'Clear') {
      if (weather.condition === 'Storm') {
        estimatedDelay += 10;
        confidence = 'Low';
      } else if (weather.condition === 'Rain') {
        estimatedDelay += 5;
        if (confidence === 'High') confidence = 'Medium';
      }
    }
    
    return {
      currentTrafficLevel: traffic?.status || 'Light',
      weatherCondition: weather?.description || 'Clear skies',
      estimatedDelay,
      confidence
    };
  } catch (error) {
    console.error('Error fetching live conditions:', error);
    return {
      currentTrafficLevel: 'Light',
      weatherCondition: 'Unknown',
      estimatedDelay: 0,
      confidence: 'Medium'
    };
  }
}

/**
 * Rank routes by composite score
 */
function rankRoutes(routes: RouteOption[]): RouteOption[] {
  return routes.sort((a, b) => {
    // Score based on: ETA (50%), safety (30%), distance (20%)
    const scoreA = 
      (1 / a.metadata.currentETAMinutes) * 50 +
      (1 - a.metadata.trafficRiskScore) * 20 +
      (1 - a.metadata.weatherRiskScore) * 10 +
      (1 / a.metadata.totalDistanceMiles) * 20;
    
    const scoreB = 
      (1 / b.metadata.currentETAMinutes) * 50 +
      (1 - b.metadata.trafficRiskScore) * 20 +
      (1 - b.metadata.weatherRiskScore) * 10 +
      (1 / b.metadata.totalDistanceMiles) * 20;
    
    return scoreB - scoreA; // Higher score first
  });
}

/**
 * Build comparison matrix
 */
function buildComparisonMatrix(routes: RouteOption[]): MultiRouteResponse['comparisonMatrix'] {
  const fastest = routes.reduce((min, r) => 
    r.metadata.currentETAMinutes < min.metadata.currentETAMinutes ? r : min
  );
  
  const shortest = routes.reduce((min, r) => 
    r.metadata.totalDistanceMiles < min.metadata.totalDistanceMiles ? r : min
  );
  
  const balanced = routes.find(r => r.metadata.routeType === 'balanced') || routes[0];
  
  return {
    fastestRoute: fastest.id,
    shortestRoute: shortest.id,
    balancedRoute: balanced.id
  };
}

/**
 * MAIN FUNCTION: Generate alternative routes with ML ranking
 */
export async function generateAlternativeRoutes(
  origin: Coordinates,
  destination: Coordinates,
  options: {
    includeHighways?: boolean;
    includeTolls?: boolean;
    maxAlternatives?: number;
  } = {}
): Promise<MultiRouteResponse> {
  console.log('🗺️ Generating alternative routes...');
  
  const { maxAlternatives = 4 } = options;
  
  try {
    // 1. Fetch OSRM alternatives
    const osrmRoutes = await fetchOSRMAlternatives(origin, destination, maxAlternatives);
    
    // 2. Enrich each route with metadata
    const enrichedRoutes: RouteOption[] = await Promise.all(
      osrmRoutes.slice(0, maxAlternatives).map(async (route, index) => {
        const metadata = calculateRouteMetadata(route);
        const liveConditions = await getLiveConditions(route.path);
        
        // Update current ETA with live conditions
        metadata.currentETAMinutes = metadata.baseETAMinutes + liveConditions.estimatedDelay;
        
        return {
          id: `route-${index + 1}`,
          path: route.path,
          segments: route.segments,
          metadata,
          liveConditions
        };
      })
    );
    
    // 3. Rank routes by composite score
    const rankedRoutes = rankRoutes(enrichedRoutes);
    
    // 4. Build comparison matrix
    const comparisonMatrix = buildComparisonMatrix(rankedRoutes);
    
    console.log(`✅ Generated ${rankedRoutes.length} alternative routes`);
    
    return {
      routes: rankedRoutes,
      recommended: rankedRoutes[0].id,
      comparisonMatrix,
      generatedAt: new Date(),
      validUntil: new Date(Date.now() + 300000) // 5 minutes cache
    };
  } catch (error) {
    console.error('Error generating alternative routes:', error);
    
    // Fallback: return single route
    const fallbackRoute = await fetchOSRMRoute([origin, destination]);
    const metadata = calculateRouteMetadata(fallbackRoute);
    const liveConditions = await getLiveConditions(fallbackRoute.path);
    
    metadata.currentETAMinutes = metadata.baseETAMinutes + liveConditions.estimatedDelay;
    
    const route: RouteOption = {
      id: 'route-1',
      path: fallbackRoute.path,
      segments: fallbackRoute.segments,
      metadata,
      liveConditions
    };
    
    return {
      routes: [route],
      recommended: 'route-1',
      comparisonMatrix: {
        fastestRoute: 'route-1',
        shortestRoute: 'route-1',
        balancedRoute: 'route-1'
      },
      generatedAt: new Date(),
      validUntil: new Date(Date.now() + 300000)
    };
  }
}

/**
 * Get current route remaining from truck position
 */
export function getCurrentRouteRemaining(
  currentRoute: RouteOption,
  truckPosition: Coordinates
): { eta: number; distance: number } {
  // Find closest point on route to truck
  let minDistance = Infinity;
  let closestIndex = 0;
  
  currentRoute.path.forEach((point, index) => {
    const distance = getDistance(truckPosition, point);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = index;
    }
  });
  
  // Calculate remaining distance
  let remainingDistance = 0;
  for (let i = closestIndex; i < currentRoute.path.length - 1; i++) {
    remainingDistance += getDistance(currentRoute.path[i], currentRoute.path[i + 1]);
  }
  
  // Estimate remaining ETA (simple average speed)
  const avgSpeed = currentRoute.metadata.totalDistanceMiles / (currentRoute.metadata.currentETAMinutes / 60);
  const remainingETA = (remainingDistance / avgSpeed) * 60;
  
  return {
    eta: Math.round(remainingETA),
    distance: remainingDistance
  };
}

/**
 * Haversine distance helper
 */
function getDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 3958.8; // Earth radius in miles
  const lat1 = coord1[0] * (Math.PI / 180);
  const lat2 = coord2[0] * (Math.PI / 180);
  const diffLat = lat2 - lat1;
  const diffLon = (coord2[1] - coord1[1]) * (Math.PI / 180);
  
  const a = Math.sin(diffLat / 2) * Math.sin(diffLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(diffLon / 2) * Math.sin(diffLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}
