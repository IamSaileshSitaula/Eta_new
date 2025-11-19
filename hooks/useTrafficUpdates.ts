/**
 * Traffic Updates Hook
 * Manages real-time traffic data fetching and updates
 */

import { useState, useEffect, useCallback } from 'react';
import { Coordinates, TrafficData } from '../types';
import { fetchRealTrafficData, getTrafficDelay } from '../services/trafficService';

interface UseTrafficUpdatesOptions {
  position: Coordinates;
  nextStop: Coordinates;
  updateInterval?: number; // milliseconds
  isEnabled?: boolean;
}

interface UseTrafficUpdatesReturn {
  traffic: TrafficData | null;
  trafficDelay: number; // minutes
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching and managing real-time traffic data
 */
export function useTrafficUpdates({
  position,
  nextStop,
  updateInterval = 120000, // 2 minutes default
  isEnabled = true
}: UseTrafficUpdatesOptions): UseTrafficUpdatesReturn {
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [trafficDelay, setTrafficDelay] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTraffic = useCallback(async () => {
    if (!isEnabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const trafficData = await fetchRealTrafficData(position);
      setTraffic(trafficData);

      // Calculate delay based on traffic conditions
      const distanceToNext = 10; // Estimate, would come from route
      const delay = getTrafficDelay(trafficData, distanceToNext);
      setTrafficDelay(delay);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch traffic data';
      setError(errorMsg);
      console.error('Traffic fetch error:', err);
      
      // Fallback to default traffic
      setTraffic({
        status: 'Light',
        description: 'Unable to fetch real-time traffic (using default)',
        currentSpeed: 60,
        normalSpeed: 70,
        speedFactor: 0.86,
        delaySeconds: 0
      });
      setTrafficDelay(0);
    } finally {
      setIsLoading(false);
    }
  }, [position, nextStop, isEnabled]);

  // Initial fetch and periodic updates
  useEffect(() => {
    fetchTraffic();

    if (!isEnabled || updateInterval <= 0) return;

    const interval = setInterval(fetchTraffic, updateInterval);

    return () => clearInterval(interval);
  }, [fetchTraffic, updateInterval, isEnabled]);

  return {
    traffic,
    trafficDelay,
    isLoading,
    error,
    refetch: fetchTraffic
  };
}

export default useTrafficUpdates;
