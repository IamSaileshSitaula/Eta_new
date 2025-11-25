/**
 * Multi-Route Generation Service
 * Generates and ranks alternative routes for long-haul segments
 */

import { Coordinates } from '../types';
import { fetchOSRMRoute, EnhancedRouteData } from './osrmService';
import { RoadSegment } from './speedSimulationService';

// Constants for fuel calculation
// In a real app, these would be fetched from an API like EIA or AAA
const AVERAGE_DIESEL_PRICE_USD = 3.85; // National average
const TRUCK_MPG = 6.5; // Average semi-truck MPG

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
    fuelCost: number;
    fuelConsumptionGallons: number;
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
      
      const distanceMiles = route.distance * 0.000621371;
      const durationSeconds = route.duration;
      
      // Sanity check: duration should be reasonable for distance
      const avgSpeedMph = (distanceMiles / (durationSeconds / 3600));
      if (avgSpeedMph > 100 || avgSpeedMph < 5) {
        console.warn(`⚠️ OSRM route has suspicious speed: ${avgSpeedMph.toFixed(1)} mph (${distanceMiles.toFixed(1)} mi in ${(durationSeconds/60).toFixed(0)} min)`);
      }
      
      routes.push({
        path,
        segments,
        totalDistance: distanceMiles,
        baseDuration: durationSeconds
      });
    }
    
    console.log(`📍 OSRM returned ${routes.length} alternative routes:`,
      routes.map((r, i) => `Route ${i+1}: ${r.totalDistance.toFixed(1)} mi in ${(r.baseDuration/60).toFixed(0)} min`)
    );
    
    return routes;
  } catch (error) {
    console.error('Error fetching OSRM alternatives:', error);
    return [await fetchOSRMRoute([origin, destination])];
  }
}

/**
 * Calculate route metadata (tolls, highways, speed limits)
 */
function calculateRouteMetadata(route: EnhancedRouteData, routeIndex: number): RouteOption['metadata'] {
  const { segments, totalDistance, baseDuration } = route;
  
  let tollRoadMiles = 0;
  let highwayMiles = 0;
  let totalSpeedLimit = 0;
  
  segments.forEach(segment => {
    // Improved toll estimation: Varies by route alternative
    // Primary route (index 0) typically has more tolls/highways
    // Alternative routes (index 1+) typically avoid tolls
    if (segment.roadType === 'highway' && segment.speedLimitMph >= 65) {
      // Primary routes use major toll highways more
      const tollProbability = routeIndex === 0 ? 0.48 : 0.06;
      tollRoadMiles += segment.distance * tollProbability;
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
  const routeType = classifyRouteType(highwayPercentage, totalDistance, baseDuration / 60, tollRoadMiles);
  
  // Estimate fuel consumption (gallons)
  const fuelConsumptionGallons = totalDistance / TRUCK_MPG;
  
  // Estimate fuel cost (USD)
  const fuelCost = fuelConsumptionGallons * AVERAGE_DIESEL_PRICE_USD;
  
  return {
    totalDistanceMiles: totalDistance,
    baseETAMinutes: Math.round(baseDuration / 60),
    currentETAMinutes: Math.round(baseDuration / 60), // Will be updated with live data
    tollRoadMiles: Math.round(tollRoadMiles * 10) / 10,
    highwayMiles: Math.round(highwayMiles * 10) / 10,
    avgSpeedLimit,
    trafficRiskScore,
    weatherRiskScore,
    routeType,
    fuelCost,
    fuelConsumptionGallons: Math.round(fuelConsumptionGallons * 100) / 100
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
  baseETAMinutes: number,
  tollRoadMiles: number
): 'fastest' | 'shortest' | 'balanced' | 'toll-free' {
  const avgSpeed = totalDistance / (baseETAMinutes / 60);
  const tollPercentage = tollRoadMiles / totalDistance;
  
  // Toll-free: Low toll roads (<5% of route)
  if (tollPercentage < 0.05 && tollRoadMiles < 10) {
    return 'toll-free';
  }
  // Fastest: High speed + high highway percentage
  else if (avgSpeed > 55 && highwayPercentage > 0.7) {
    return 'fastest';
  }
  // Shortest: Minimal distance
  else if (totalDistance < 100 && highwayPercentage < 0.4) {
    return 'shortest';
  }
  // Balanced: Everything else
  else {
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
  if (routes.length === 0) return routes;

  const etaValues = routes.map(r => r.metadata.currentETAMinutes);
  const distanceValues = routes.map(r => r.metadata.totalDistanceMiles);
  const tollValues = routes.map(r => r.metadata.tollRoadMiles);
  const fuelValues = routes.map(r => r.metadata.fuelCost);

  const minMax = (values: number[]) => ({
    min: Math.min(...values),
    max: Math.max(...values)
  });

  const { min: minEta, max: maxEta } = minMax(etaValues);
  const { min: minDistance, max: maxDistance } = minMax(distanceValues);
  const { min: minToll, max: maxToll } = minMax(tollValues);
  const { min: minFuel, max: maxFuel } = minMax(fuelValues);

  const normalizeLowerBetter = (value: number, min: number, max: number) => {
    if (max === min) return 1;
    return 1 - (value - min) / (max - min);
  };

  const routeScores = routes.map(route => {
    const { metadata, liveConditions } = route;
    const etaScore = normalizeLowerBetter(metadata.currentETAMinutes, minEta, maxEta);
    const distanceScore = normalizeLowerBetter(metadata.totalDistanceMiles, minDistance, maxDistance);
    const tollScore = normalizeLowerBetter(metadata.tollRoadMiles, minToll, maxToll);
    const fuelScore = normalizeLowerBetter(metadata.fuelCost, minFuel, maxFuel);
    const trafficScore = 1 - metadata.trafficRiskScore; // lower risk better
    const weatherScore = 1 - metadata.weatherRiskScore;

    const confidenceBonus = liveConditions.confidence === 'High'
      ? 0.05
      : liveConditions.confidence === 'Medium'
        ? 0.025
        : 0;

    const score =
      etaScore * 0.45 +
      distanceScore * 0.15 +
      fuelScore * 0.15 +
      tollScore * 0.10 +
      trafficScore * 0.08 +
      weatherScore * 0.07 +
      confidenceBonus;

    return { id: route.id, score };
  });

  const scoreLookup = Object.fromEntries(routeScores.map(({ id, score }) => [id, score]));

  return [...routes].sort((a, b) => (scoreLookup[b.id] ?? 0) - (scoreLookup[a.id] ?? 0));
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
        const metadata = calculateRouteMetadata(route, index);
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
    const metadata = calculateRouteMetadata(fallbackRoute, 0);
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
