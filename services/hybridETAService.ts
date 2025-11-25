/**
 * Hybrid ETA Service
 * Combines TomTom real-time traffic, ML predictions, and physics-based simulation
 * for accurate multi-stop delivery ETAs
 */

import { Stop, TrafficData, WeatherData, Coordinates } from '../types';
import { fetchRealTrafficData } from './trafficService';
import { RoadSegment } from './speedSimulationService';
import { mlService } from './mlBackendService';

interface MLETARequest {
  currentLocation: Coordinates;
  stops: Stop[];
  currentSpeed: number;
  trafficData: TrafficData;
  weatherData: WeatherData;
  timeOfDay: string;
  dayOfWeek: string;
  historicalData?: {
    averageSpeedAtThisTime: number;
    typicalDelayMinutes: number;
  };
}

interface MLETAResponse {
  predictions: {
    stopId: string;
    estimatedArrivalMinutes: number;
    confidence: number;
    factors: {
      trafficImpact: number;
      weatherImpact: number;
      timeOfDayImpact: number;
      historicalPattern: number;
    };
  }[];
  totalEstimatedMinutes: number;
  modelConfidence: number;
  fallbackUsed: boolean;
}

interface HybridETAResult {
  stopId: string;
  mlETA: number;
  physicsETA: number;
  hybridETA: number; // Weighted combination
  confidence: number;
  method: 'ml-primary' | 'physics-primary' | 'balanced' | 'fallback';
  breakdown: {
    baseTime: number;
    trafficDelay: number;
    weatherDelay: number;
    unloadingTime: number;
    bufferTime: number;
  };
}

/**
 * Get ML-based ETA predictions from backend
 */
async function getMLETAPredictions(request: MLETARequest): Promise<MLETAResponse | null> {
  try {
    const ML_BACKEND_URL = 'http://localhost:8000';

    // Transform data to match Python backend Pydantic models
    const payload = {
      currentLocation: { lat: request.currentLocation[0], lng: request.currentLocation[1] },
      stops: request.stops.map(s => ({
        id: s.id,
        name: s.name,
        location: { lat: s.location[0], lng: s.location[1] },
        unloadingTimeMinutes: s.unloadingTimeMinutes || 0
      })),
      currentSpeed: request.currentSpeed,
      trafficData: {
        congestionLevel: request.trafficData.status,
        currentSpeed: request.trafficData.currentSpeed,
        freeFlowSpeed: request.trafficData.normalSpeed
      },
      weatherData: {
        description: request.weatherData.description || request.weatherData.condition,
        temperature: request.weatherData.temperature,
        windSpeed: 0 // Default to 0 as it's not in frontend types
      },
      timeOfDay: request.timeOfDay,
      dayOfWeek: request.dayOfWeek,
      historicalData: request.historicalData
    };

    const response = await fetch(`${ML_BACKEND_URL}/api/eta/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      console.warn('ML ETA prediction failed:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.warn('ML ETA service unavailable, using fallback:', error);
    return null;
  }
}

/**
 * Calculate physics-based ETA using current simulation logic
 */
function calculatePhysicsETA(
  distanceKm: number,
  roadSegments: RoadSegment[],
  traffic: TrafficData,
  weather: WeatherData,
  unloadingMinutes: number = 0
): { eta: number; breakdown: HybridETAResult['breakdown'] } {
  let totalMinutes = 0;
  let trafficDelay = 0;
  let weatherDelay = 0;

  if (roadSegments.length === 0) {
    // Fallback: simple distance/speed calculation
    const baseSpeed = 60; // mph
    const speedKmh = baseSpeed * 1.60934;
    totalMinutes = (distanceKm / speedKmh) * 60;
  } else {
    // Calculate segment-by-segment with traffic/weather impacts
    for (const segment of roadSegments) {
      const segmentKm = segment.distance;
      let speedMph = segment.speedLimitMph || 60;

      // Apply traffic impact
      const trafficMultiplier = getTrafficSpeedMultiplier(traffic);
      const weatherMultiplier = getWeatherSpeedMultiplier(weather);
      
      const originalSpeed = speedMph;
      speedMph *= trafficMultiplier * weatherMultiplier;

      const speedKmh = speedMph * 1.60934;
      const segmentMinutes = (segmentKm / speedKmh) * 60;
      
      totalMinutes += segmentMinutes;

      // Track delays
      const originalMinutes = (segmentKm / (originalSpeed * 1.60934)) * 60;
      const delay = segmentMinutes - originalMinutes;
      
      if (trafficMultiplier < 1) trafficDelay += delay * 0.7; // Estimate 70% from traffic
      if (weatherMultiplier < 1) weatherDelay += delay * 0.3; // Estimate 30% from weather
    }
  }

  return {
    eta: totalMinutes + unloadingMinutes,
    breakdown: {
      baseTime: totalMinutes - trafficDelay - weatherDelay,
      trafficDelay,
      weatherDelay,
      unloadingTime: unloadingMinutes,
      bufferTime: 0,
    },
  };
}

/**
 * Get traffic speed multiplier from TomTom data
 */
function getTrafficSpeedMultiplier(traffic: TrafficData): number {
  if (!traffic) return 1.0;

  switch (traffic.status) {
    case 'Heavy':
      return 0.5; // 50% speed reduction
    case 'Moderate':
      return 0.75; // 25% speed reduction
    case 'Light':
      return 0.9; // 10% speed reduction
    default:
      return 1.0;
  }
}

/**
 * Get weather speed multiplier
 */
function getWeatherSpeedMultiplier(weather: WeatherData): number {
  if (!weather) return 1.0;

  const condition = weather.description?.toLowerCase() || '';
  
  if (condition.includes('storm') || condition.includes('heavy rain')) {
    return 0.6; // 40% reduction
  } else if (condition.includes('rain') || condition.includes('snow')) {
    return 0.8; // 20% reduction
  } else if (condition.includes('fog') || condition.includes('mist')) {
    return 0.85; // 15% reduction
  }
  
  return 1.0;
}

/**
 * Calculate hybrid ETA by combining ML and physics-based predictions
 */
function combineETAPredictions(
  mlPrediction: { estimatedArrivalMinutes: number; confidence: number } | null,
  physicsResult: { eta: number; breakdown: HybridETAResult['breakdown'] },
  stopId: string
): HybridETAResult {
  if (!mlPrediction) {
    // ML unavailable, use physics only
    return {
      stopId,
      mlETA: 0,
      physicsETA: physicsResult.eta,
      hybridETA: physicsResult.eta,
      confidence: 0.7, // Physics-only has moderate confidence
      method: 'fallback',
      breakdown: physicsResult.breakdown,
    };
  }

  const mlConfidence = mlPrediction.confidence;
  const physicsConfidence = 0.7; // Base confidence for physics model

  // Weighted average based on confidence
  // If ML confidence is high (>0.8), trust it more
  // If ML confidence is low (<0.5), trust physics more
  let mlWeight: number;
  let physicsWeight: number;

  if (mlConfidence > 0.8) {
    mlWeight = 0.7;
    physicsWeight = 0.3;
  } else if (mlConfidence > 0.6) {
    mlWeight = 0.5;
    physicsWeight = 0.5;
  } else {
    mlWeight = 0.3;
    physicsWeight = 0.7;
  }

  const hybridETA = (mlPrediction.estimatedArrivalMinutes * mlWeight) + 
                    (physicsResult.eta * physicsWeight);

  const method: HybridETAResult['method'] = 
    mlWeight > 0.6 ? 'ml-primary' :
    physicsWeight > 0.6 ? 'physics-primary' :
    'balanced';

  return {
    stopId,
    mlETA: mlPrediction.estimatedArrivalMinutes,
    physicsETA: physicsResult.eta,
    hybridETA: Math.round(hybridETA),
    confidence: Math.max(mlConfidence, physicsConfidence),
    method,
    breakdown: physicsResult.breakdown,
  };
}

/**
 * Main hybrid ETA calculation function
 * Combines TomTom traffic, ML predictions, and physics simulation
 */
export async function calculateHybridETAs(
  currentLocation: Coordinates,
  remainingStops: Stop[],
  currentSpeed: number,
  roadSegmentsByStop: Map<string, { segments: RoadSegment[]; distanceKm: number }>,
  weatherData: WeatherData
): Promise<HybridETAResult[]> {
  
  // Get current time context
  const now = new Date();
  const timeOfDay = now.toTimeString().substring(0, 5); // "HH:MM"
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];

  // Fetch TomTom traffic data for all stops in parallel
  const trafficPromises = remainingStops.map(stop =>
    fetchRealTrafficData(stop.location)
  );
  const trafficResults = await Promise.allSettled(trafficPromises);
  
  const trafficDataByStop = new Map<string, TrafficData>();
  trafficResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      trafficDataByStop.set(remainingStops[index].id, result.value);
    }
  });

  // Prepare ML request
  const mlRequest: MLETARequest = {
    currentLocation,
    stops: remainingStops,
    currentSpeed,
    trafficData: trafficDataByStop.get(remainingStops[0]?.id) || {} as TrafficData,
    weatherData,
    timeOfDay,
    dayOfWeek,
    historicalData: {
      averageSpeedAtThisTime: currentSpeed || 60,
      typicalDelayMinutes: 5,
    },
  };

  // Get ML predictions (with timeout)
  const mlResponse = await getMLETAPredictions(mlRequest);

  // Calculate hybrid ETAs for each stop
  const hybridResults: HybridETAResult[] = [];
  let cumulativeMinutes = 0;

  for (let i = 0; i < remainingStops.length; i++) {
    const stop = remainingStops[i];
    const segmentData = roadSegmentsByStop.get(stop.id);
    const traffic = trafficDataByStop.get(stop.id);
    
    if (!segmentData) {
      console.warn(`No segment data for stop ${stop.id}`);
      continue;
    }

    // Physics-based calculation
    const physicsResult = calculatePhysicsETA(
      segmentData.distanceKm,
      segmentData.segments,
      traffic || {} as TrafficData,
      weatherData,
      stop.unloadingTimeMinutes || 0
    );

    // Add cumulative time from previous stops
    physicsResult.eta += cumulativeMinutes;

    // Find ML prediction for this stop
    const mlPrediction = mlResponse?.predictions.find(p => p.stopId === stop.id);

    // Combine predictions
    const hybridResult = combineETAPredictions(mlPrediction, physicsResult, stop.id);

    // Add buffer time for uncertainty (2-5 minutes based on confidence)
    const bufferMinutes = Math.round((1 - hybridResult.confidence) * 5);
    hybridResult.breakdown.bufferTime = bufferMinutes;
    hybridResult.hybridETA += bufferMinutes;

    hybridResults.push(hybridResult);

    // Update cumulative time for next stop
    cumulativeMinutes = hybridResult.hybridETA;
  }

  return hybridResults;
}

/**
 * Get simple ETA for next stop (used in dashboard)
 */
export async function getNextStopHybridETA(
  currentLocation: Coordinates,
  nextStop: Stop,
  roadSegments: RoadSegment[],
  distanceKm: number,
  currentSpeed: number,
  traffic: TrafficData,
  weather: WeatherData
): Promise<number> {
  
  const now = new Date();
  const timeOfDay = now.toTimeString().substring(0, 5);
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];

  // Try ML prediction
  const mlRequest: MLETARequest = {
    currentLocation,
    stops: [nextStop],
    currentSpeed,
    trafficData: traffic,
    weatherData: weather,
    timeOfDay,
    dayOfWeek,
  };

  const mlResponse = await getMLETAPredictions(mlRequest);
  
  // Calculate physics-based ETA
  const physicsResult = calculatePhysicsETA(
    distanceKm,
    roadSegments,
    traffic,
    weather,
    0 // Don't include unloading in ETA display
  );

  // If ML available, combine; otherwise use physics
  if (mlResponse && mlResponse.predictions.length > 0) {
    const mlPrediction = mlResponse.predictions[0];
    const mlWeight = mlPrediction.confidence > 0.7 ? 0.6 : 0.4;
    const physicsWeight = 1 - mlWeight;
    
    return Math.round(
      (mlPrediction.estimatedArrivalMinutes * mlWeight) + 
      (physicsResult.eta * physicsWeight)
    );
  }

  return Math.round(physicsResult.eta);
}

/**
 * Export breakdown for debugging/display
 */
export function formatETABreakdown(result: HybridETAResult): string {
  const { breakdown } = result;
  const parts = [
    `Base: ${Math.round(breakdown.baseTime)}min`,
    breakdown.trafficDelay > 0 ? `+${Math.round(breakdown.trafficDelay)}min traffic` : null,
    breakdown.weatherDelay > 0 ? `+${Math.round(breakdown.weatherDelay)}min weather` : null,
    breakdown.bufferTime > 0 ? `+${breakdown.bufferTime}min buffer` : null,
  ].filter(Boolean);
  
  return parts.join(', ');
}
