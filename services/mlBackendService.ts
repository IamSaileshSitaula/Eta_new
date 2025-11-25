
const ML_BACKEND_URL = 'http://localhost:8000/api';

export interface MLRouteRequest {
  currentLocation: { lat: number; lng: number };
  remainingStops: any[];
  currentTraffic: any;
  currentWeather: any;
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

export const mlService = {
  /**
   * Calls the GNN model to optimize stop sequence
   */
  async optimizeRoute(data: MLRouteRequest) {
    try {
      const response = await fetch(`${ML_BACKEND_URL}/reroute/last-mile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw new Error('ML Backend offline');
      
      const result = await response.json();
      console.log('🤖 ML Optimization Success:', result);
      return result;
    } catch (error) {
      console.warn('⚠️ ML Backend unavailable, switching to heuristic fallback.');
      return null;
    }
  },

  /**
   * Calls the LaDe model for high-precision ETA
   */
  async predictETA(data: MLEtaRequest) {
    try {
      const response = await fetch(`${ML_BACKEND_URL}/eta/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) throw new Error('ML Backend offline');
      
      const result = await response.json();
      return result; // Expected: { eta: number, confidence: number }
    } catch (error) {
      // Silent fail for ETA to allow physics fallback
      return null;
    }
  }
};
