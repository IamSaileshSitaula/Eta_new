/**
 * Weather Updates Hook
 * Manages real-time weather data fetching and updates
 */

import { useState, useEffect, useCallback } from 'react';
import { Coordinates, WeatherData } from '../types';
import { fetchRealWeatherData, getWeatherDelay } from '../services/weatherService';

interface UseWeatherUpdatesOptions {
  position: Coordinates;
  updateInterval?: number; // milliseconds
  isEnabled?: boolean;
}

interface UseWeatherUpdatesReturn {
  weather: WeatherData | null;
  weatherDelay: number; // minutes
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Hook for fetching and managing real-time weather data
 */
export function useWeatherUpdates({
  position,
  updateInterval = 300000, // 5 minutes default
  isEnabled = true
}: UseWeatherUpdatesOptions): UseWeatherUpdatesReturn {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherDelay, setWeatherDelay] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async () => {
    if (!isEnabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const weatherData = await fetchRealWeatherData(position);
      setWeather(weatherData);

      // Calculate delay based on weather conditions
      const distanceRemaining = 50; // Estimate
      const delay = getWeatherDelay(weatherData, distanceRemaining);
      setWeatherDelay(delay);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch weather data';
      setError(errorMsg);
      console.error('Weather fetch error:', err);
      
      // Fallback to default weather
      setWeather({
        condition: 'Clear',
        description: 'Unable to fetch real-time weather (using default)',
        temperature: 72
      });
      setWeatherDelay(0);
    } finally {
      setIsLoading(false);
    }
  }, [position, isEnabled]);

  // Initial fetch and periodic updates
  useEffect(() => {
    fetchWeather();

    if (!isEnabled || updateInterval <= 0) return;

    const interval = setInterval(fetchWeather, updateInterval);

    return () => clearInterval(interval);
  }, [fetchWeather, updateInterval, isEnabled]);

  return {
    weather,
    weatherDelay,
    isLoading,
    error,
    refetch: fetchWeather
  };
}

export default useWeatherUpdates;
