/**
 * Last-Mile Optimization Service
 * Communicates with ML backend for AI-powered stop sequence optimization
 */

import { Stop, Coordinates } from '../types';
import { mlService } from './mlBackendService';

export interface OptimizationRequest {
  stops: Stop[];
  vehicleStartPosition?: { lat: number; lng: number };
  currentSequence?: string[];
  constraints?: {
    maxDeviationMiles?: number;
    priorityStops?: string[];
    timeWindows?: Array<{
      stopId: string;
      earliestTime?: string;
      latestTime?: string;
    }>;
  };
}

export interface OptimizationResult {
  optimizedSequence: string[];
  timeSavings: number; // minutes
  distanceSavings: number; // miles
  confidence: number; // 0-1
  routePath: Array<{ lat: number; lng: number }>;
  estimatedDurations: Array<{
    fromStopId: string;
    toStopId: string;
    durationMinutes: number;
    distanceMiles: number;
  }>;
  reasoning: string;
  comparisonMetrics: {
    currentRoute: {
      totalDistance: number;
      totalTime: number;
      averageStopDistance: number;
    };
    optimizedRoute: {
      totalDistance: number;
      totalTime: number;
      averageStopDistance: number;
    };
  };
}

/**
 * Request AI-powered optimization for last-mile stop sequence
 */
export async function optimizeStopSequence(
  request: OptimizationRequest
): Promise<OptimizationResult> {
  try {
    // Use the centralized ML service
    const data = await mlService.optimizeRoute({
      currentLocation: request.vehicleStartPosition || { lat: 0, lng: 0 },
      remainingStops: request.stops.map(s => ({
        id: s.id,
        name: s.name,
        location: coordsToLatLng(s.location),
        unloadingTimeMinutes: s.unloadingTimeMinutes || 0
      })),
      currentTraffic: { congestionLevel: 'light', currentSpeed: 30 },
      currentWeather: { description: 'clear' },
      timeOfDay: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
      dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' })
    });

    if (!data) {
      console.warn('ML backend returned null, using fallback optimization.');
      return fallbackOptimization(request);
    }

    return {
      optimizedSequence: data.optimized_sequence,
      timeSavings: data.time_savings_minutes || 0,
      distanceSavings: data.distance_savings_miles || 0,
      confidence: data.confidence || 0.7,
      routePath: data.route_path || [],
      estimatedDurations: data.segment_durations || [],
      reasoning: data.reasoning || 'Optimized using graph neural network analysis',
      comparisonMetrics: data.comparison_metrics || buildDefaultComparison(request.stops)
    };
  } catch (error) {
    console.warn('Last-mile optimization connection failed, using fallback:', error);
    
    // Fallback: Greedy nearest-neighbor heuristic
    return fallbackOptimization(request);
  }
}

/**
 * Fallback optimization using simple nearest-neighbor greedy algorithm
 */
function fallbackOptimization(request: OptimizationRequest): OptimizationResult {
  const { stops, vehicleStartPosition, currentSequence } = request;
  
  if (stops.length <= 1) {
    return {
      optimizedSequence: stops.map(s => s.id),
      timeSavings: 0,
      distanceSavings: 0,
      confidence: 1.0,
      routePath: stops.map(s => coordsToLatLng(s.location)),
      estimatedDurations: [],
      reasoning: 'Single stop - no optimization needed',
      comparisonMetrics: buildDefaultComparison(stops)
    };
  }

  // Start from vehicle position or first stop
  const startPos = vehicleStartPosition || coordsToLatLng(stops[0].location);
  
  const unvisited = new Set(stops.map(s => s.id));
  const optimized: string[] = [];
  let currentPos = startPos;
  let totalDistance = 0;
  const routePath: Array<{ lat: number; lng: number }> = [startPos];

  // Greedy nearest-neighbor
  while (unvisited.size > 0) {
    let nearestId: string | null = null;
    let nearestDist = Infinity;

    for (const stopId of unvisited) {
      const stop = stops.find(s => s.id === stopId)!;
      const dist = calculateDistance(currentPos, coordsToLatLng(stop.location));
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = stopId;
      }
    }

    if (nearestId) {
      optimized.push(nearestId);
      unvisited.delete(nearestId);
      const nextStop = stops.find(s => s.id === nearestId)!;
      const nextPos = coordsToLatLng(nextStop.location);
      currentPos = nextPos;
      routePath.push(currentPos);
      totalDistance += nearestDist;
    }
  }

  // Calculate current sequence distance
  const currentDist = calculateSequenceDistance(
    currentSequence || stops.map(s => s.id),
    stops,
    startPos
  );

  const timeSavings = (currentDist - totalDistance) * 2; // ~2 min per mile
  const distanceSavings = currentDist - totalDistance;

  // Calculate dynamic confidence based on improvement
  // Higher savings = higher confidence that this is a better route
  const improvementRatio = currentDist > 0 ? (currentDist - totalDistance) / currentDist : 0;
  let calculatedConfidence = 0.65; // Base confidence for heuristic

  if (improvementRatio > 0.25) calculatedConfidence = 0.85; // Significant improvement
  else if (improvementRatio > 0.15) calculatedConfidence = 0.75; // Moderate improvement
  else if (improvementRatio > 0.05) calculatedConfidence = 0.70; // Slight improvement

  return {
    optimizedSequence: optimized,
    timeSavings: Math.max(0, timeSavings),
    distanceSavings: Math.max(0, distanceSavings),
    confidence: calculatedConfidence,
    routePath,
    estimatedDurations: buildEstimatedDurations(optimized, stops),
    reasoning: 'Optimized using nearest-neighbor heuristic (ML backend unavailable)',
    comparisonMetrics: {
      currentRoute: {
        totalDistance: currentDist,
        totalTime: currentDist * 2,
        averageStopDistance: currentDist / stops.length
      },
      optimizedRoute: {
        totalDistance,
        totalTime: totalDistance * 2,
        averageStopDistance: totalDistance / stops.length
      }
    }
  };
}

/**
 * Calculate Haversine distance between two coordinates (in miles)
 */
function calculateDistance(pos1: { lat: number; lng: number }, pos2: { lat: number; lng: number }): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(pos2.lat - pos1.lat);
  const dLon = toRad(pos2.lng - pos1.lng);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(pos1.lat)) * Math.cos(toRad(pos2.lat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Convert Coordinates tuple to lat/lng object
 */
function coordsToLatLng(coords: Coordinates): { lat: number; lng: number } {
  return { lat: coords[0], lng: coords[1] };
}

/**
 * Calculate total distance for a given stop sequence
 */
function calculateSequenceDistance(
  sequence: string[],
  stops: Stop[],
  startPos: { lat: number; lng: number }
): number {
  let totalDist = 0;
  let currentPos = startPos;

  for (const stopId of sequence) {
    const stop = stops.find(s => s.id === stopId);
    if (!stop) continue;
    
    const stopPos = coordsToLatLng(stop.location);
    totalDist += calculateDistance(currentPos, stopPos);
    currentPos = stopPos;
  }

  return totalDist;
}

/**
 * Build estimated segment durations
 */
function buildEstimatedDurations(
  sequence: string[],
  stops: Stop[]
): Array<{ fromStopId: string; toStopId: string; durationMinutes: number; distanceMiles: number }> {
  const durations: Array<{
    fromStopId: string;
    toStopId: string;
    durationMinutes: number;
    distanceMiles: number;
  }> = [];

  for (let i = 0; i < sequence.length - 1; i++) {
    const fromStop = stops.find(s => s.id === sequence[i])!;
    const toStop = stops.find(s => s.id === sequence[i + 1])!;
    const dist = calculateDistance(coordsToLatLng(fromStop.location), coordsToLatLng(toStop.location));

    durations.push({
      fromStopId: fromStop.id,
      toStopId: toStop.id,
      distanceMiles: dist,
      durationMinutes: dist * 2 // ~30 mph average city driving
    });
  }

  return durations;
}

/**
 * Build default comparison metrics
 */
function buildDefaultComparison(stops: Stop[]) {
  const avgDistance = stops.length > 1 ? 5 : 0;
  return {
    currentRoute: {
      totalDistance: avgDistance * stops.length,
      totalTime: avgDistance * stops.length * 2,
      averageStopDistance: avgDistance
    },
    optimizedRoute: {
      totalDistance: avgDistance * stops.length,
      totalTime: avgDistance * stops.length * 2,
      averageStopDistance: avgDistance
    }
  };
}

/**
 * Validate an optimized sequence before applying
 */
export function validateOptimizedSequence(
  originalStops: Stop[],
  optimizedSequence: string[]
): { valid: boolean; error?: string } {
  // Check same number of stops
  if (originalStops.length !== optimizedSequence.length) {
    return {
      valid: false,
      error: `Sequence length mismatch: expected ${originalStops.length}, got ${optimizedSequence.length}`
    };
  }

  // Check all stop IDs present
  const originalIds = new Set(originalStops.map(s => s.id));
  const optimizedIds = new Set(optimizedSequence);

  if (originalIds.size !== optimizedIds.size) {
    return {
      valid: false,
      error: 'Stop ID count mismatch'
    };
  }

  for (const id of optimizedSequence) {
    if (!originalIds.has(id)) {
      return {
        valid: false,
        error: `Unknown stop ID in optimized sequence: ${id}`
      };
    }
  }

  return { valid: true };
}

/**
 * Calculate confidence level based on number of stops and constraints
 */
export function estimateOptimizationConfidence(
  stopCount: number,
  hasConstraints: boolean
): number {
  // Base confidence decreases with stop count (harder problem)
  let confidence = 0.9 - (stopCount - 2) * 0.05;
  
  // Constraints add complexity
  if (hasConstraints) {
    confidence -= 0.1;
  }

  return Math.max(0.5, Math.min(0.95, confidence));
}

export default {
  optimizeStopSequence,
  validateOptimizedSequence,
  estimateOptimizationConfidence
};
