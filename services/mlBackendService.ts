/**
 * ML Backend Service
 * Handles communication with the Python ML backend for AI-powered predictions
 */

const ML_BACKEND_URL = import.meta.env.VITE_ML_BACKEND_URL || 'http://localhost:8000/api';
const REQUEST_TIMEOUT_MS = 10000; // 10 seconds
const MAX_RETRIES = 2;

export interface MLRouteRequest {
  currentLocation: { lat: number; lng: number };
  remainingStops: Array<{
    id: string;
    name: string;
    location: { lat: number; lng: number };
    unloadingTimeMinutes: number;
  }>;
  currentTraffic: { congestionLevel: string; currentSpeed: number };
  currentWeather: { description: string };
  timeOfDay: string;
  dayOfWeek: string;
}

export interface MLEtaRequest {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  traffic: string;
  weather: string;
  timeOfDay: string;
  dayOfWeek: string;
}

export interface MLRouteResponse {
  optimized_sequence: string[];
  time_savings_minutes: number;
  distance_savings_miles: number;
  confidence: number;
  route_path: Array<{ lat: number; lng: number }>;
  segment_durations: Array<{
    fromStopId: string;
    toStopId: string;
    durationMinutes: number;
    distanceMiles: number;
  }>;
  reasoning: string;
  comparison_metrics: {
    currentRoute: { totalDistance: number; totalTime: number; averageStopDistance: number };
    optimizedRoute: { totalDistance: number; totalTime: number; averageStopDistance: number };
  };
}

export interface MLEtaResponse {
  eta: number;
  confidence: number;
}

/**
 * Fetch with timeout and retry logic
 */
async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      const isLastAttempt = attempt === retries;
      
      if (error.name === 'AbortError') {
        console.warn(`⏱️ ML request timeout (attempt ${attempt + 1}/${retries + 1})`);
      } else {
        console.warn(`⚠️ ML request failed (attempt ${attempt + 1}/${retries + 1}):`, error.message);
      }

      if (isLastAttempt) {
        return null;
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
    }
  }
  return null;
}

/**
 * Check if ML backend is available
 */
let mlBackendAvailable: boolean | null = null;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute

async function checkMLBackendHealth(): Promise<boolean> {
  const now = Date.now();
  if (mlBackendAvailable !== null && now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return mlBackendAvailable;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    
    const response = await fetch(`${ML_BACKEND_URL}/health`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    mlBackendAvailable = response.ok;
    lastHealthCheck = now;
    
    if (mlBackendAvailable) {
      console.log('✅ ML Backend is available');
    }
  } catch {
    mlBackendAvailable = false;
    lastHealthCheck = now;
  }

  return mlBackendAvailable;
}

export const mlService = {
  /**
   * Check ML backend availability
   */
  isAvailable: checkMLBackendHealth,

  /**
   * Calls the GNN model to optimize stop sequence
   */
  async optimizeRoute(data: MLRouteRequest): Promise<MLRouteResponse | null> {
    // Quick health check first
    const isHealthy = await checkMLBackendHealth();
    if (!isHealthy) {
      console.log('⏭️ Skipping ML optimization - backend unavailable');
      return null;
    }

    console.log('🤖 Requesting ML route optimization...');
    
    const result = await fetchWithRetry<MLRouteResponse>(
      `${ML_BACKEND_URL}/reroute/last-mile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }
    );

    if (result) {
      console.log('✅ ML Optimization Success:', {
        savings: result.time_savings_minutes,
        confidence: result.confidence
      });
    }

    return result;
  },

  /**
   * Calls the LaDe model for high-precision ETA
   */
  async predictETA(data: MLEtaRequest): Promise<MLEtaResponse | null> {
    const isHealthy = await checkMLBackendHealth();
    if (!isHealthy) {
      return null;
    }

    return await fetchWithRetry<MLEtaResponse>(
      `${ML_BACKEND_URL}/eta/predict`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }
    );
  },

  /**
   * Force refresh health check
   */
  async refreshHealth(): Promise<boolean> {
    lastHealthCheck = 0;
    mlBackendAvailable = null;
    return await checkMLBackendHealth();
  }
};

export default mlService;