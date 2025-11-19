/**
 * Route Simulation Hook
 * Handles truck position simulation along a route path
 */

import { useState, useEffect, useRef } from 'react';
import { Coordinates } from '../types';
import { SIMULATION_INTERVAL_MS } from '../constants';
import { calculateRealisticSpeed, applyAcceleration, addSpeedVariation, RoadSegment } from '../services/speedSimulationService';

// Haversine formula to calculate distance between two coordinates
export const getDistance = (coord1: Coordinates, coord2: Coordinates): number => {
  const R = 3958.8; // Radius of the Earth in miles
  const rlat1 = coord1[0] * (Math.PI / 180);
  const rlat2 = coord2[0] * (Math.PI / 180);
  const diffLat = rlat2 - rlat1;
  const diffLng = (coord2[1] - coord1[1]) * (Math.PI / 180);
  const d = 2 * R * Math.asin(Math.sqrt(
    Math.sin(diffLat / 2) * Math.sin(diffLat / 2) +
    Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(diffLng / 2) * Math.sin(diffLng / 2)
  ));
  return d;
};

interface UseRouteSimulationOptions {
  routePath: Coordinates[];
  startPosition?: Coordinates;
  isPaused?: boolean;
  onPositionChange?: (position: Coordinates, pathIndex: number) => void;
  onDestinationReached?: () => void;
}

interface UseRouteSimulationReturn {
  currentPosition: Coordinates;
  pathIndex: number;
  progress: number; // 0-1
  distanceRemaining: number; // miles
  isSimulating: boolean;
  resetSimulation: () => void;
  setPosition: (position: Coordinates, index: number) => void;
}

/**
 * Hook for simulating truck movement along a route
 */
export function useRouteSimulation({
  routePath,
  startPosition,
  isPaused = false,
  onPositionChange,
  onDestinationReached
}: UseRouteSimulationOptions): UseRouteSimulationReturn {
  const [currentPosition, setCurrentPosition] = useState<Coordinates>(
    startPosition || routePath[0] || [0, 0]
  );
  const [pathIndex, setPathIndex] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);
  
  const simulationRef = useRef<NodeJS.Timeout | null>(null);
  const currentSpeedRef = useRef(0); // Current speed in mph
  const lastUpdateTimeRef = useRef(Date.now());

  // Calculate progress and distance remaining
  const { progress, distanceRemaining } = (() => {
    if (routePath.length <= 1) {
      return { progress: 1, distanceRemaining: 0 };
    }

    let totalDistance = 0;
    let coveredDistance = 0;

    // Calculate total route distance
    for (let i = 0; i < routePath.length - 1; i++) {
      const segmentDist = getDistance(routePath[i], routePath[i + 1]);
      totalDistance += segmentDist;
      
      if (i < pathIndex) {
        coveredDistance += segmentDist;
      }
    }

    // Add partial progress on current segment
    if (pathIndex < routePath.length - 1) {
      const currentSegmentDist = getDistance(routePath[pathIndex], currentPosition);
      coveredDistance += currentSegmentDist;
    }

    const remaining = Math.max(0, totalDistance - coveredDistance);
    const progressValue = totalDistance > 0 ? coveredDistance / totalDistance : 1;

    return { 
      progress: Math.min(1, progressValue), 
      distanceRemaining: remaining 
    };
  })();

  // Simulation loop
  useEffect(() => {
    if (isPaused || routePath.length <= 1 || pathIndex >= routePath.length - 1) {
      setIsSimulating(false);
      return;
    }

    setIsSimulating(true);

    simulationRef.current = setInterval(() => {
      const now = Date.now();
      const deltaTimeSeconds = (now - lastUpdateTimeRef.current) / 1000;
      lastUpdateTimeRef.current = now;

      setPathIndex(prevIndex => {
        if (prevIndex >= routePath.length - 1) {
          onDestinationReached?.();
          return prevIndex;
        }

        const currentCoord = routePath[prevIndex];
        const nextCoord = routePath[prevIndex + 1];

        // Use simplified speed calculation (skip detailed road analysis for now)
        const distanceToNext = getDistance(currentCoord, nextCoord);
        const targetSpeed = 65; // Average highway speed in mph
        const acceleratedSpeed = applyAcceleration(currentSpeedRef.current, targetSpeed, deltaTimeSeconds);
        const finalSpeed = addSpeedVariation(acceleratedSpeed);
        currentSpeedRef.current = finalSpeed;

        // Calculate distance traveled in this interval
        const distanceTraveledMiles = (finalSpeed * deltaTimeSeconds) / 3600; // mph * seconds / 3600
        const segmentDistance = getDistance(currentCoord, nextCoord);

        // Check if we've reached the next waypoint
        if (distanceTraveledMiles >= segmentDistance) {
          const newPosition = nextCoord;
          setCurrentPosition(newPosition);
          onPositionChange?.(newPosition, prevIndex + 1);
          return prevIndex + 1;
        } else {
          // Interpolate position along segment
          const fraction = distanceTraveledMiles / segmentDistance;
          const newLat = currentCoord[0] + (nextCoord[0] - currentCoord[0]) * fraction;
          const newLng = currentCoord[1] + (nextCoord[1] - currentCoord[1]) * fraction;
          const newPosition: Coordinates = [newLat, newLng];
          
          setCurrentPosition(newPosition);
          onPositionChange?.(newPosition, prevIndex);
          return prevIndex;
        }
      });
    }, SIMULATION_INTERVAL_MS);

    return () => {
      if (simulationRef.current) {
        clearInterval(simulationRef.current);
      }
    };
  }, [routePath, pathIndex, isPaused, onPositionChange, onDestinationReached]);

  const resetSimulation = () => {
    setPathIndex(0);
    setCurrentPosition(startPosition || routePath[0]);
    currentSpeedRef.current = 0;
    lastUpdateTimeRef.current = Date.now();
  };

  const setPosition = (position: Coordinates, index: number) => {
    setCurrentPosition(position);
    setPathIndex(index);
  };

  return {
    currentPosition,
    pathIndex,
    progress,
    distanceRemaining,
    isSimulating,
    resetSimulation,
    setPosition
  };
}

export default useRouteSimulation;
