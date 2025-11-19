/**
 * Rerouting Engine Hook
 * Continuous evaluation of alternative routes with ML-based confidence scoring
 */

import { useState, useEffect, useCallback } from 'react';
import { Shipment, Coordinates, UserRole, ConfidenceLevel, Stop } from '../types';
import { RouteOption, generateAlternativeRoutes, getCurrentRouteRemaining } from '../services/multiRouteService';
import { fetchRealTrafficData } from '../services/trafficService';
import { fetchRealWeatherData } from '../services/weatherService';

export interface RerouteEvaluation {
  shouldReroute: boolean;
  confidence: ConfidenceLevel;
  timeSavings: number;
  newRoute: RouteOption;
  reason: string;
  historicalAccuracy: number;
  comparisonData: {
    currentETA: number;
    newETA: number;
    currentDistance: number;
    newDistance: number;
  };
}

interface HistoricalData {
  avgAccuracy: number;
  totalPredictions: number;
  successfulReroutes: number;
}

/**
 * Hook for continuous rerouting evaluation
 */
export function useReroutingEngine(
  shipment: Shipment,
  truckPosition: Coordinates,
  currentRoute: RouteOption | null,
  role: UserRole
) {
  const [rerouteEval, setRerouteEval] = useState<RerouteEvaluation | null>(null);
  const [evaluationInterval, setEvaluationInterval] = useState(120000); // 2 min default
  const [isEvaluating, setIsEvaluating] = useState(false);

  const evaluateRerouting = useCallback(async () => {
    if (role !== UserRole.MANAGER || !currentRoute) return;
    if (isEvaluating) return; // Prevent concurrent evaluations
    
    setIsEvaluating(true);
    console.log('🔄 Evaluating rerouting options...');
    
    try {
      // 1. Get next destination
      const nextStop = getNextPendingStop(shipment);
      if (!nextStop) {
        setRerouteEval(null);
        setIsEvaluating(false);
        return;
      }
      
      // 2. Generate alternative routes from current position
      const alternatives = await generateAlternativeRoutes(
        truckPosition,
        nextStop.location,
        { includeHighways: true, includeTolls: true, maxAlternatives: 3 }
      );
      
      if (alternatives.routes.length === 0) {
        setRerouteEval(null);
        setIsEvaluating(false);
        return;
      }
      
      // 3. Compare current route vs best alternative
      const currentRemaining = getCurrentRouteRemaining(currentRoute, truckPosition);
      const bestAlternative = alternatives.routes[0];
      
      const timeDiff = currentRemaining.eta - bestAlternative.metadata.currentETAMinutes;
      
      // 4. ML-based confidence using historical data
      const historicalData = await getHistoricalRerouteAccuracy(
        truckPosition,
        nextStop.location
      );
      
      const [traffic, weather] = await Promise.all([
        fetchRealTrafficData(truckPosition).catch(() => null),
        fetchRealWeatherData(truckPosition).catch(() => null)
      ]);
      
      const confidence = calculateRerouteConfidence({
        timeSavings: timeDiff,
        trafficData: traffic,
        weatherData: weather,
        historicalAccuracy: historicalData.avgAccuracy,
        routeSimilarity: calculateRouteSimilarity(currentRoute, bestAlternative)
      });
      
      // 5. Threshold check: Only suggest if >5 min savings AND confidence >50%
      if (timeDiff > 5 && confidence.level !== ConfidenceLevel.LOW) {
        setRerouteEval({
          shouldReroute: true,
          confidence: confidence.level,
          timeSavings: timeDiff,
          newRoute: bestAlternative,
          reason: buildRerouteReason(currentRemaining, bestAlternative, confidence, traffic, weather),
          historicalAccuracy: historicalData.avgAccuracy,
          comparisonData: {
            currentETA: currentRemaining.eta,
            newETA: bestAlternative.metadata.currentETAMinutes,
            currentDistance: currentRemaining.distance,
            newDistance: bestAlternative.metadata.totalDistanceMiles
          }
        });
      } else {
        setRerouteEval(null);
      }
    } catch (error) {
      console.error('Error evaluating rerouting:', error);
      setRerouteEval(null);
    } finally {
      setIsEvaluating(false);
    }
  }, [shipment, truckPosition, currentRoute, role, isEvaluating]);

  // Continuous evaluation loop
  useEffect(() => {
    if (role !== UserRole.MANAGER) return;
    
    // Initial evaluation
    evaluateRerouting();
    
    // Re-evaluate periodically
    const interval = setInterval(evaluateRerouting, evaluationInterval);
    return () => clearInterval(interval);
  }, [role, evaluateRerouting, evaluationInterval]);

  return {
    rerouteEval,
    isEvaluating,
    forceEvaluation: evaluateRerouting
  };
}

/**
 * Get next pending stop
 */
function getNextPendingStop(shipment: Shipment): Stop | null {
  const allStops = [
    shipment.origin,
    ...(shipment.longHaulStops || []),
    shipment.hub,
    ...shipment.lastMileStops
  ];
  
  const nextStop = allStops.find(stop => stop.status === 'Pending' || stop.status === 'In Progress');
  return nextStop || null;
}

/**
 * Calculate reroute confidence using hybrid approach
 */
function calculateRerouteConfidence(params: {
  timeSavings: number;
  trafficData: any;
  weatherData: any;
  historicalAccuracy: number;
  routeSimilarity: number;
}): { level: ConfidenceLevel; score: number } {
  let score = 0;
  
  // 1. Historical accuracy weight (40%)
  score += (params.historicalAccuracy / 100) * 0.4;
  
  // 2. Live data quality (30%)
  const liveDataQuality = (params.trafficData ? 0.5 : 0) + (params.weatherData ? 0.5 : 0);
  score += liveDataQuality * 0.3;
  
  // 3. Time savings magnitude (20%)
  const savingsScore = Math.min(params.timeSavings / 30, 1.0); // Cap at 30 min
  score += savingsScore * 0.2;
  
  // 4. Route familiarity (10%)
  score += params.routeSimilarity * 0.1;
  
  // Map to confidence levels
  if (score >= 0.75) return { level: ConfidenceLevel.HIGH, score };
  if (score >= 0.50) return { level: ConfidenceLevel.MEDIUM, score };
  return { level: ConfidenceLevel.LOW, score };
}

/**
 * Calculate similarity between two routes (0-1)
 */
function calculateRouteSimilarity(route1: RouteOption, route2: RouteOption): number {
  // Simple heuristic: compare highway percentages and total distance
  const dist1 = route1.metadata.totalDistanceMiles;
  const dist2 = route2.metadata.totalDistanceMiles;
  const distanceSimilarity = 1 - Math.abs(dist1 - dist2) / Math.max(dist1, dist2);
  
  const highway1 = route1.metadata.highwayMiles / dist1;
  const highway2 = route2.metadata.highwayMiles / dist2;
  const highwaySimilarity = 1 - Math.abs(highway1 - highway2);
  
  return (distanceSimilarity * 0.6 + highwaySimilarity * 0.4);
}

/**
 * Build human-readable reroute reason
 */
function buildRerouteReason(
  currentRemaining: { eta: number; distance: number },
  newRoute: RouteOption,
  confidence: { level: ConfidenceLevel; score: number },
  traffic: any,
  weather: any
): string {
  const reasons: string[] = [];
  
  if (traffic && traffic.status === 'Heavy') {
    reasons.push('heavy traffic on current route');
  } else if (traffic && traffic.status === 'Moderate') {
    reasons.push('moderate congestion ahead');
  }
  
  if (weather && weather.condition === 'Storm') {
    reasons.push('severe weather conditions');
  } else if (weather && weather.condition === 'Rain') {
    reasons.push('rain affecting travel times');
  }
  
  if (newRoute.metadata.routeType === 'fastest') {
    reasons.push('faster alternative available');
  }
  
  if (reasons.length === 0) {
    reasons.push('alternative route found');
  }
  
  const timeSaved = currentRemaining.eta - newRoute.metadata.currentETAMinutes;
  
  return `${reasons.join(', ').charAt(0).toUpperCase() + reasons.join(', ').slice(1)}. ` +
         `Switch to save approximately ${Math.round(timeSaved)} minutes.`;
}

/**
 * Get historical reroute accuracy (simulated for now, will use database later)
 */
async function getHistoricalRerouteAccuracy(
  origin: Coordinates,
  destination: Coordinates
): Promise<HistoricalData> {
  // TODO: Query database for historical reroute predictions
  // For now, return simulated data based on route characteristics
  
  // Simulate based on distance
  const distance = getDistance(origin, destination);
  
  let avgAccuracy = 70; // Base accuracy
  
  if (distance < 50) {
    avgAccuracy = 85; // Short routes more predictable
  } else if (distance > 200) {
    avgAccuracy = 65; // Long routes less predictable
  }
  
  return {
    avgAccuracy,
    totalPredictions: Math.floor(Math.random() * 50) + 20,
    successfulReroutes: Math.floor(Math.random() * 30) + 10
  };
}

function getDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 3958.8;
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
