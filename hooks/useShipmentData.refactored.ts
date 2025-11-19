/**
 * Refactored Shipment Data Hook (Simplified)
 * Uses composition of smaller hooks for better maintainability
 * 
 * This is the NEW version - replaces the 700-line useShipmentData.ts
 * Old version kept as useShipmentData.legacy.ts for reference
 */

import { useState, useEffect, useMemo, Dispatch, SetStateAction } from 'react';
import { Shipment, Coordinates, ShipmentStatus, UserRole, ConfidenceLevel } from '../types';
import { useRouteSimulation } from './useRouteSimulation';
import { useTrafficUpdates } from './useTrafficUpdates';
import { useWeatherUpdates } from './useWeatherUpdates';
import { useReroutingEngine } from './useReroutingEngine';
import { generateAlternativeRoutes } from '../services/multiRouteService';
import { getNextStopHybridETA } from '../services/hybridETAService';

interface UseShipmentDataReturn {
  // Core shipment state
  shipment: Shipment;
  setShipment: Dispatch<SetStateAction<Shipment>>;
  
  // Position and progress
  truckPosition: Coordinates;
  progress: number;
  distanceRemaining: number;
  
  // ETA and confidence
  eta: number;
  confidence: ConfidenceLevel;
  nextStopETA: number;
  
  // Real-time conditions
  traffic: ReturnType<typeof useTrafficUpdates>['traffic'];
  weather: ReturnType<typeof useWeatherUpdates>['weather'];
  
  // Rerouting
  rerouteEvaluation: ReturnType<typeof useReroutingEngine>;
  
  // Route management
  currentRoute: { id: string; path: Coordinates[] } | null;
  alternativeRoutes: any[];
  loadAlternativeRoutes: () => Promise<void>;
  
  // Loading states
  isLoading: boolean;
  isSimulating: boolean;
}

/**
 * Main hook for managing shipment data and real-time updates
 * 
 * This refactored version:
 * - Uses smaller, focused hooks for simulation, traffic, weather
 * - Separates concerns (simulation vs data fetching vs rerouting)
 * - Easier to test and maintain
 * - Better TypeScript inference
 */
export function useShipmentData(
  initialShipmentData: Shipment,
  role: UserRole,
  recipientStopId?: string
): UseShipmentDataReturn {
  const [shipment, setShipment] = useState<Shipment>(initialShipmentData);
  const [isLoading, setIsLoading] = useState(true);
  const [currentRoute, setCurrentRoute] = useState<{ id: string; path: Coordinates[] } | null>(null);
  const [alternativeRoutes, setAlternativeRoutes] = useState<any[]>([]);

  // Determine current origin and destination based on leg
  const { origin, destination } = useMemo(() => {
    if (shipment.currentLegIndex === 0) {
      // Long-haul: Origin -> Hub
      return {
        origin: shipment.origin.location,
        destination: shipment.hub.location
      };
    } else {
      // Last-mile: Hub -> Current last-mile stop
      const currentStopIndex = shipment.currentLegIndex - 1;
      const currentStop = shipment.lastMileStops[currentStopIndex];
      return {
        origin: shipment.hub.location,
        destination: currentStop?.location || shipment.hub.location
      };
    }
  }, [shipment]);

  // Load route on mount or when leg changes
  useEffect(() => {
    const loadRoute = async () => {
      setIsLoading(true);
      try {
        // Generate routes using new dynamic system
        const result = await generateAlternativeRoutes(origin, destination, {
          maxAlternatives: 4
        });

        if (result.routes.length > 0) {
          // Use recommended route as current (route-1 is always recommended)
          const recommended = result.routes.find(r => r.id === 'route-1') || result.routes[0];
          setCurrentRoute({
            id: recommended.id,
            path: recommended.path
          });
          setAlternativeRoutes(result.routes);
        } else {
          // Fallback to simple direct path
          setCurrentRoute({
            id: 'direct',
            path: [origin, destination]
          });
        }
      } catch (error) {
        console.error('Failed to load route:', error);
        // Fallback
        setCurrentRoute({
          id: 'fallback',
          path: [origin, destination]
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadRoute();
  }, [origin[0], origin[1], destination[0], destination[1]]);

  // Route simulation
  const simulation = useRouteSimulation({
    routePath: currentRoute?.path || [origin],
    startPosition: origin,
    isPaused: isLoading || !currentRoute,
    onPositionChange: (position, index) => {
      // Position updated - could trigger events here
    },
    onDestinationReached: () => {
      console.log('Destination reached!');
      // Update shipment status, move to next leg, etc.
    }
  });

  // Traffic updates
  const trafficData = useTrafficUpdates({
    position: simulation.currentPosition,
    nextStop: destination,
    updateInterval: 120000, // 2 minutes
    isEnabled: !isLoading
  });

  // Weather updates
  const weatherData = useWeatherUpdates({
    position: simulation.currentPosition,
    updateInterval: 300000, // 5 minutes
    isEnabled: !isLoading
  });

  // Calculate ETA using hybrid model (simplified for now)
  const { eta, confidence, nextStopETA } = useMemo(() => {
    if (!currentRoute || isLoading) {
      return { eta: 0, confidence: ConfidenceLevel.LOW, nextStopETA: 0 };
    }

    try {
      // Simplified ETA calculation (distance / speed)
      const distanceRemaining = simulation.distanceRemaining;
      const avgSpeed = 60; // mph
      const etaMinutes = (distanceRemaining / avgSpeed) * 60;
      
      // Determine confidence based on data quality
      const hasGoodData = trafficData.traffic && weatherData.weather;
      const confidenceLevel = hasGoodData ? ConfidenceLevel.HIGH : ConfidenceLevel.MEDIUM;

      return {
        eta: etaMinutes,
        confidence: confidenceLevel,
        nextStopETA: etaMinutes
      };
    } catch (error) {
      console.error('ETA calculation failed:', error);
      return { eta: 0, confidence: ConfidenceLevel.LOW, nextStopETA: 0 };
    }
  }, [simulation.currentPosition, destination, currentRoute, trafficData.traffic, weatherData.weather, isLoading]);

  // Rerouting evaluation (only for managers)
  const rerouteEvaluation = useReroutingEngine(
    shipment,
    simulation.currentPosition,
    currentRoute,
    role
  );

  // Function to manually load alternative routes
  const loadAlternativeRoutes = async () => {
    try {
      const result = await generateAlternativeRoutes(origin, destination, {
        maxAlternatives: 4
      });
      setAlternativeRoutes(result.routes);
    } catch (error) {
      console.error('Failed to load alternative routes:', error);
    }
  };

  return {
    // Core state
    shipment,
    setShipment,
    
    // Position
    truckPosition: simulation.currentPosition,
    progress: simulation.progress,
    distanceRemaining: simulation.distanceRemaining,
    
    // ETA
    eta,
    confidence,
    nextStopETA,
    
    // Conditions
    traffic: trafficData.traffic,
    weather: weatherData.weather,
    
    // Rerouting
    rerouteEvaluation,
    
    // Routes
    currentRoute,
    alternativeRoutes,
    loadAlternativeRoutes,
    
    // Loading
    isLoading,
    isSimulating: simulation.isSimulating
  };
}

export default useShipmentData;
