import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shipment,
  Coordinates,
  ShipmentStatus,
  TrafficData,
  WeatherData,
  ConfidenceLevel,
  UserRole,
  RerouteSuggestion,
  Stop,
} from '../types';
import { SIMULATION_INTERVAL_MS } from '../constants';
import { getDelayExplanation } from '../services/geminiService';
import { fetchOSRMRoute, EnhancedRouteData } from '../services/osrmService';
import { fetchRealWeatherData, getWeatherDelay } from '../services/weatherService';
import { fetchRealTrafficData, getTrafficDelay } from '../services/trafficService';
import { 
  calculateRealisticSpeed, 
  applyAcceleration,
  addSpeedVariation,
  RoadSegment 
} from '../services/speedSimulationService';

// Haversine formula to calculate distance between two coordinates
const getDistance = (coord1: Coordinates, coord2: Coordinates) => {
  const R = 3958.8; // Radius of the Earth in miles
  const rlat1 = coord1[0] * (Math.PI / 180);
  const rlat2 = coord2[0] * (Math.PI / 180);
  const diffLat = rlat2 - rlat1;
  const diffLng = (coord2[1] - coord1[1]) * (Math.PI / 180);
  const d = 2 * R * Math.asin(Math.sqrt(Math.sin(diffLat / 2) * Math.sin(diffLat / 2) + Math.cos(rlat1) * Math.cos(rlat2) * Math.sin(diffLng / 2) * Math.sin(diffLng / 2)));
  return d;
};


export const useShipmentData = (initialShipmentData: Shipment, role: UserRole, recipientStopId?: string) => {
  const [shipment, setShipment] = useState<Shipment>(initialShipmentData);
  const [truckPosition, setTruckPosition] = useState<Coordinates>(initialShipmentData.origin.location);
  const [eta, setEta] = useState<number>(0);
  const [confidence, setConfidence] = useState<ConfidenceLevel>(ConfidenceLevel.HIGH);
  const [traffic, setTraffic] = useState<TrafficData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [delayReason, setDelayReason] = useState<string | null>(null);
  const [rerouteSuggestion, setRerouteSuggestion] = useState<RerouteSuggestion | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pathIndex, setPathIndex] = useState(0);
  const [detailedFullPath, setDetailedFullPath] = useState<Coordinates[]>([]);
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>([]);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0); // Current speed in mph
  const [timeSinceLastStop, setTimeSinceLastStop] = useState<number>(0); // Seconds since last stop
  const [isCurrentlyStopped, setIsCurrentlyStopped] = useState<boolean>(false);
  const [stopTimeRemaining, setStopTimeRemaining] = useState<number>(0); // Seconds

  const fullRouteStops = useMemo(() => {
    return [shipment.origin, ...(shipment.longHaulStops || []), shipment.hub, ...shipment.lastMileStops];
  }, [shipment]);

  const hubIndex = useMemo(() => 1 + (shipment.longHaulStops?.length || 0), [shipment.longHaulStops]);
  
  // Fetch OSRM routes on mount with enhanced road metadata
  useEffect(() => {
    const fetchRoutes = async () => {
      // Get key points for the route (all stops)
      const allStops = fullRouteStops.map(stop => stop.location);
      
      // Fetch real road route from OSRM with road segments
      const routeData: EnhancedRouteData = await fetchOSRMRoute(allStops);
      
      setDetailedFullPath(routeData.path);
      setRoadSegments(routeData.segments);
    };
    
    fetchRoutes();
  }, [fullRouteStops]);

  const stopPathIndices = useMemo(() => {
    if (detailedFullPath.length === 0) return new Map<string, number>();
    
    const indices = new Map<string, number>();
    fullRouteStops.forEach(stop => {
        let closestIndex = -1;
        let minDistance = Infinity;
        detailedFullPath.forEach((point, index) => {
            const distance = getDistance(stop.location, point);
            // Use a small tolerance to find the exact point
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        });
        if (closestIndex !== -1) {
            indices.set(stop.id, closestIndex);
        }
    });
    return indices;
  }, [fullRouteStops, detailedFullPath]);

  // Fetch real-time weather and traffic data
  const updateExternalData = useCallback(async () => {
    // Fetch real weather data at truck's current location
    const weatherData = await fetchRealWeatherData(truckPosition);
    setWeather(weatherData);
    
    // Fetch real traffic data at truck's current location  
    const trafficData = await fetchRealTrafficData(truckPosition);
    setTraffic(trafficData);

    // Calculate delays based on real weather and traffic
    const remainingDistance = detailedFullPath.length > pathIndex 
      ? detailedFullPath.slice(pathIndex).reduce((total, point, i, arr) => {
          if (i === arr.length - 1) return total;
          return total + getDistance(point, arr[i + 1]);
        }, 0)
      : 0;
    
    const weatherDelay = getWeatherDelay(weatherData, remainingDistance);
    const trafficDelay = getTrafficDelay(trafficData, remainingDistance, 'arterial');
    const totalDelay = weatherDelay + trafficDelay;

    if (totalDelay > 0) {
      // Determine confidence level based on delay severity
      let confidenceLevel = ConfidenceLevel.HIGH;
      if (totalDelay > 20) confidenceLevel = ConfidenceLevel.MEDIUM;
      if (totalDelay > 40) confidenceLevel = ConfidenceLevel.LOW;
      
      const reason = await getDelayExplanation(
        totalDelay, 
        `${trafficData.status} traffic and ${weatherData.condition.toLowerCase()} conditions`, 
        confidenceLevel
      );
      setDelayReason(reason);
      setConfidence(confidenceLevel);
      setShipment(s => ({...s, status: ShipmentStatus.DELAYED}));
    } else {
      setDelayReason(null);
      setConfidence(ConfidenceLevel.HIGH);
    }
    
    // Suggest reroute if heavy traffic
    if (trafficData.status === 'Heavy' && !rerouteSuggestion) {
      setRerouteSuggestion({
        reason: "Heavy traffic detected on the current route.",
        newRouteId: 'R2-alt',
        timeSavingsMinutes: 15,
        confidence: ConfidenceLevel.HIGH
      });
    }
  }, [rerouteSuggestion, truckPosition, detailedFullPath, pathIndex]);


  useEffect(() => {
    updateExternalData();
    // Update weather and traffic every 5 minutes (300,000 ms) to save API calls
    const interval = setInterval(updateExternalData, 300000);
    return () => clearInterval(interval);
  }, [updateExternalData]);
  
  const simulationStateRef = useRef({ 
    shipment, 
    truckPosition, 
    pathIndex, 
    currentSpeed, 
    timeSinceLastStop,
    isCurrentlyStopped,
    stopTimeRemaining 
  });
  
  simulationStateRef.current = { 
    shipment, 
    truckPosition, 
    pathIndex, 
    currentSpeed,
    timeSinceLastStop,
    isCurrentlyStopped,
    stopTimeRemaining
  };

  useEffect(() => {
    if (detailedFullPath.length === 0 || roadSegments.length === 0) return; // Wait for OSRM route to load
    
    setIsLoading(false);
    
    const simulationTick = () => {
        const { 
          shipment: currentShipment, 
          truckPosition: currentPosition, 
          pathIndex: currentPathIndex,
          currentSpeed: vehicleSpeed,
          timeSinceLastStop: lastStopTime,
          isCurrentlyStopped: isStopped,
          stopTimeRemaining: stopRemaining
        } = simulationStateRef.current;

        if (currentShipment.status === ShipmentStatus.DELIVERED || currentPathIndex >= detailedFullPath.length - 1) {
            clearInterval(simulationInterval);
            if (currentShipment.status !== ShipmentStatus.DELIVERED) {
              setShipment(s => ({...s, status: ShipmentStatus.DELIVERED}));
            }
            return;
        }

        let newShipmentState = { ...currentShipment };
        const intervalSeconds = SIMULATION_INTERVAL_MS / 1000;
        
        // Handle stopped state (at traffic light, stop sign, etc.)
        if (isStopped && stopRemaining > 0) {
          const newStopTime = Math.max(0, stopRemaining - intervalSeconds);
          setStopTimeRemaining(newStopTime);
          setTimeSinceLastStop(0); // Reset timer
          
          if (newStopTime === 0) {
            setIsCurrentlyStopped(false);
            setCurrentSpeed(0); // Will accelerate from stop
          }
          return; // Don't move while stopped
        }
        
        // Get current road segment
        const currentSegment = roadSegments[Math.min(currentPathIndex, roadSegments.length - 1)];
        
        // Calculate realistic speed for this segment
        const speedCalc = calculateRealisticSpeed(
          currentSegment,
          traffic,
          weather,
          lastStopTime
        );
        
        // Check if we should stop
        if (speedCalc.shouldStop && !isStopped) {
          setIsCurrentlyStopped(true);
          setStopTimeRemaining(speedCalc.stopDuration);
          setCurrentSpeed(0);
          return;
        }
        
        // Apply acceleration/deceleration to reach target speed
        const targetSpeed = addSpeedVariation(speedCalc.adjustedSpeedMph);
        const newSpeed = applyAcceleration(vehicleSpeed, targetSpeed, intervalSeconds);
        setCurrentSpeed(newSpeed);
        
        // Calculate distance traveled this tick (convert mph to miles per interval)
        const travelDistance = (newSpeed * intervalSeconds) / 3600;
        
        let nextPathIndex = currentPathIndex;
        let newPosition = currentPosition;
        let remainingTravel = travelDistance;

        // Move along the path
        while (remainingTravel > 0 && nextPathIndex < detailedFullPath.length - 1) {
            const startPoint = newPosition;
            const endPoint = detailedFullPath[nextPathIndex + 1];
            const distanceToEndPoint = getDistance(startPoint, endPoint);

            if (remainingTravel >= distanceToEndPoint) {
                remainingTravel -= distanceToEndPoint;
                nextPathIndex++;
                newPosition = detailedFullPath[nextPathIndex];
            } else {
                const ratio = remainingTravel / distanceToEndPoint;
                const lat = startPoint[0] + (endPoint[0] - startPoint[0]) * ratio;
                const lon = startPoint[1] + (endPoint[1] - startPoint[1]) * ratio;
                newPosition = [lat, lon];
                remainingTravel = 0;
            }
        }
        
        setTruckPosition(newPosition);
        setPathIndex(nextPathIndex);
        setTimeSinceLastStop(lastStopTime + intervalSeconds);
        
        // Check if reached a stop
        const nextStopData = fullRouteStops[newShipmentState.currentLegIndex + 1];
        if (nextStopData) {
            const targetPathIndex = stopPathIndices.get(nextStopData.id);

            if (targetPathIndex !== undefined && nextPathIndex >= targetPathIndex && newShipmentState.currentLegIndex < fullRouteStops.length - 2) {
                const newCurrentLegIndex = newShipmentState.currentLegIndex + 1;
                const completedStop = fullRouteStops[newCurrentLegIndex];
                
                newShipmentState.longHaulStops = newShipmentState.longHaulStops.map(s => s.id === completedStop.id ? { ...s, status: 'Completed' } : s);
                newShipmentState.lastMileStops = newShipmentState.lastMileStops.map(s => s.id === completedStop.id ? { ...s, status: 'Completed' } : s);
                if (newShipmentState.hub.id === completedStop.id) {
                    newShipmentState.hub = { ...newShipmentState.hub, status: 'Completed' };
                }

                if (delayReason === null) {
                    if (newCurrentLegIndex < hubIndex) {
                        newShipmentState.status = ShipmentStatus.IN_TRANSIT_LONG_HAUL;
                    } else if (newCurrentLegIndex === hubIndex) {
                        newShipmentState.status = ShipmentStatus.AT_HUB;
                    } else {
                        newShipmentState.status = ShipmentStatus.IN_TRANSIT_LAST_MILE;
                    }
                }
                newShipmentState.currentLegIndex = newCurrentLegIndex;
            }
        }
        
        if (newShipmentState.status === ShipmentStatus.PENDING) {
            newShipmentState.status = ShipmentStatus.IN_TRANSIT_LONG_HAUL;
        }

        setShipment(newShipmentState);
        
        // Calculate ETA with dynamic speeds
        const etaStop = fullRouteStops[newShipmentState.currentLegIndex + 1];
        if (etaStop) {
            const etaStopPathIndex = stopPathIndices.get(etaStop.id);
            if (etaStopPathIndex !== undefined) {
                let remainingDistance = getDistance(newPosition, detailedFullPath[nextPathIndex]);
                for (let i = nextPathIndex; i < etaStopPathIndex && i < detailedFullPath.length - 1; i++) {
                    remainingDistance += getDistance(detailedFullPath[i], detailedFullPath[i+1]);
                }
                
                // Use current speed as baseline, adjusted for conditions
                const avgSpeed = Math.max(newSpeed, 30); // Minimum 30 mph average
                let baseTime = (remainingDistance / avgSpeed) * 60; // minutes
                
                // Add weather and traffic delays
                const weatherDelay = getWeatherDelay(weather, remainingDistance);
                const trafficDelay = getTrafficDelay(traffic, remainingDistance, currentSegment.roadType);
                
                const totalEta = Math.round(baseTime + weatherDelay + trafficDelay);
                setEta(totalEta);
                
                // Update confidence based on conditions
                let newConfidence = ConfidenceLevel.HIGH;
                if (weather?.condition === 'Storm' || traffic?.status === 'Heavy') {
                  newConfidence = ConfidenceLevel.LOW;
                } else if (weather?.condition === 'Rain' || traffic?.status === 'Moderate') {
                  newConfidence = ConfidenceLevel.MEDIUM;
                }
                setConfidence(newConfidence);
            }
        } else {
            setEta(0);
        }
    };
    
    const simulationInterval = setInterval(simulationTick, SIMULATION_INTERVAL_MS);
    
    return () => clearInterval(simulationInterval);
  }, [detailedFullPath, stopPathIndices, fullRouteStops, delayReason, hubIndex]);

  const isVisible = useMemo(() => {
    if (role === UserRole.MANAGER) return true;
    if (role === UserRole.SUPPLIER) return shipment.currentLegIndex < hubIndex;
    if (role === UserRole.RECIPIENT) {
      const recipientStopIndex = fullRouteStops.findIndex(s => s.id === recipientStopId);
      return shipment.currentLegIndex >= hubIndex && recipientStopIndex !== -1 && shipment.currentLegIndex <= recipientStopIndex;
    }
    return false;
  }, [role, shipment.currentLegIndex, recipientStopId, fullRouteStops, hubIndex]);


  const { visibleStops, visiblePath } = useMemo(() => {
    if (role === UserRole.MANAGER) {
      return { visibleStops: fullRouteStops, visiblePath: detailedFullPath };
    }
    if (role === UserRole.SUPPLIER) {
      const stops = fullRouteStops.slice(0, hubIndex + 1);
      const endPathIndex = stopPathIndices.get(stops[stops.length - 1].id) || 0;
      const path = detailedFullPath.slice(0, endPathIndex + 1);
      return { visibleStops: stops, visiblePath: path };
    }
    if (role === UserRole.RECIPIENT) {
        const recipientIndex = fullRouteStops.findIndex(s => s.id === recipientStopId);
        if (recipientIndex > -1) {
            const stops = fullRouteStops.slice(hubIndex, recipientIndex + 1);
            const startPathIndex = stopPathIndices.get(stops[0].id) || 0;
            const endPathIndex = stopPathIndices.get(stops[stops.length - 1].id) || 0;
            const path = detailedFullPath.slice(startPathIndex, endPathIndex + 1);
            return { visibleStops: stops, visiblePath: path };
        }
    }
    return { visibleStops: [], visiblePath: [] };
  }, [role, fullRouteStops, detailedFullPath, recipientStopId, hubIndex, stopPathIndices]);

  return { 
    shipment, 
    truckPosition, 
    eta, 
    confidence, 
    traffic, 
    weather, 
    delayReason, 
    rerouteSuggestion, 
    isLoading,
    isVisible,
    visibleStops,
    visiblePath
  };
};
