import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Shipment,
  Coordinates,
  ShipmentStatus,
  TrafficData,
  WeatherData,
  ConfidenceLevel,
  UserRole,
  Stop,
} from '../types';
import { SIMULATION_INTERVAL_MS } from '../constants';
import { getDelayExplanation, predictUnloadingTime } from '../services/geminiService';
import { fetchOSRMRoute, EnhancedRouteData } from '../services/osrmService';
import { fetchRealWeatherData, getWeatherDelay } from '../services/weatherService';
import { fetchRealTrafficData, getTrafficDelay } from '../services/trafficService';
// ❌ REMOVED: mlReroutingService - use useReroutingEngine hook instead
import { getNextStopHybridETA, calculateHybridETAs } from '../services/hybridETAService';
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
  // ❌ REMOVED: rerouteSuggestion - use useReroutingEngine hook instead for continuous evaluation
  const [isLoading, setIsLoading] = useState(true);
  const [pathIndex, setPathIndex] = useState(0);
  const [detailedFullPath, setDetailedFullPath] = useState<Coordinates[]>([]);
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>([]);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0); // Current speed in mph
  const [lastApiUpdate, setLastApiUpdate] = useState<Date>(new Date());
  const [nextApiUpdate, setNextApiUpdate] = useState<Date>(new Date(Date.now() + 60000));
  const lastEtaCalculation = useRef<number>(0); // Timestamp of last ETA calculation
  const [timeSinceLastStop, setTimeSinceLastStop] = useState<number>(0); // Seconds since last stop
  const [isCurrentlyStopped, setIsCurrentlyStopped] = useState<boolean>(false);
  const [stopTimeRemaining, setStopTimeRemaining] = useState<number>(0); // Seconds
  const [isUnloading, setIsUnloading] = useState<boolean>(false); // Truck is currently unloading
  const [unloadingTimeRemaining, setUnloadingTimeRemaining] = useState<number>(0); // Seconds remaining for unloading
  const [currentUnloadingStop, setCurrentUnloadingStop] = useState<string | null>(null); // Stop ID being unloaded

  const fullRouteStops = useMemo(() => {
    return [shipment.origin, ...(shipment.longHaulStops || []), shipment.hub, ...shipment.lastMileStops];
  }, [shipment]);

  const hubIndex = useMemo(() => 1 + (shipment.longHaulStops?.length || 0), [shipment.longHaulStops]);
  
  // Fetch OSRM routes on mount with enhanced road metadata
  useEffect(() => {
    const fetchRoutes = async () => {
      try {
        console.log('🗺️ Fetching OSRM route...');
        console.log('📍 Full Route Stops:', fullRouteStops.map((s, i) => `${i}: ${s.name} (${s.id})`));
        // Get key points for the route (all stops)
        const allStops = fullRouteStops.map(stop => stop.location);
        
        // Fetch real road route from OSRM with road segments
        const routeData: EnhancedRouteData = await fetchOSRMRoute(allStops);
        
        console.log('✅ OSRM route loaded:', { 
          pathPoints: routeData.path.length, 
          segments: routeData.segments.length 
        });
        
        setDetailedFullPath(routeData.path);
        setRoadSegments(routeData.segments);
        setIsLoading(false);
      } catch (error) {
        console.error('❌ Failed to fetch OSRM route:', error);
        setIsLoading(false);
      }
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
    console.log('🔄 Updating weather and traffic data...');
    const updateTime = new Date();
    setLastApiUpdate(updateTime);
    setNextApiUpdate(new Date(updateTime.getTime() + 60000)); // Next update in 60 seconds
    
    // Force ETA recalculation on next tick after API update
    lastEtaCalculation.current = 0;
    
    let weatherData = null;
    let trafficData = null;
    
    // Fetch real weather data at truck's current location
    try {
      weatherData = await fetchRealWeatherData(truckPosition);
      setWeather(weatherData);
      console.log('✅ Weather data updated:', weatherData);
    } catch (error) {
      console.error('❌ Failed to fetch weather data:', error);
      setWeather(null);
    }
    
    // Fetch real traffic data at truck's current location  
    try {
      trafficData = await fetchRealTrafficData(truckPosition);
      setTraffic(trafficData);
      console.log('✅ Traffic data updated:', trafficData);
    } catch (error) {
      console.error('❌ Failed to fetch traffic data:', error);
      setTraffic(null);
    }

    // Calculate delays based on distance to NEXT STOP only (not entire route)
    const nextStopIndex = shipment.currentLegIndex + 1;
    const nextStop = fullRouteStops[nextStopIndex];
    
    let distanceToNextStop = 0;
    if (nextStop && detailedFullPath.length > pathIndex) {
      const nextStopPathIndex = Array.from(stopPathIndices.values())[nextStopIndex];
      if (nextStopPathIndex !== undefined) {
        // Calculate distance only to next stop
        for (let i = pathIndex; i < nextStopPathIndex && i < detailedFullPath.length - 1; i++) {
          distanceToNextStop += getDistance(detailedFullPath[i], detailedFullPath[i + 1]);
        }
      }
    }
    
    // Only calculate delays if we have a valid distance to next stop and valid data
    if (distanceToNextStop > 0 && weatherData && trafficData) {
      const weatherDelay = getWeatherDelay(weatherData, distanceToNextStop);
      const trafficDelay = getTrafficDelay(trafficData, distanceToNextStop, 'arterial');
      const totalDelay = weatherDelay + trafficDelay;

      console.log('⏱️ Delay calculation:', { 
        distanceToNextStop, 
        weatherDelay, 
        trafficDelay, 
        totalDelay 
      });

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
    } else {
      setDelayReason(null);
      setConfidence(ConfidenceLevel.HIGH);
    }
    
    // ❌ REMOVED: Hardcoded reroute trigger - replaced by useReroutingEngine hook
    // Old logic: if (trafficData && trafficData.status === 'Heavy') setRerouteSuggestion({...})
    // New approach: Use continuous evaluation with ML confidence scoring
    // See: hooks/useReroutingEngine.ts for proper reroute evaluation
  }, [truckPosition]); // Only depend on truckPosition, not the changing pathIndex/detailedFullPath


  useEffect(() => {
    // Call API immediately on mount to get initial data
    updateExternalData();
    
    // NOTE: Traffic/Weather updates are now synchronized with truck position updates
    // Both happen inside the simulationTick function every SIMULATION_INTERVAL_MS (60 seconds)
    // This ensures position and external data are always in sync
    
    // No separate interval needed - handled in simulationTick
  }, []); // Only call once on mount
  
  const simulationStateRef = useRef({ 
    shipment, 
    truckPosition, 
    pathIndex, 
    currentSpeed, 
    timeSinceLastStop,
    isCurrentlyStopped,
    stopTimeRemaining,
    isUnloading,
    unloadingTimeRemaining,
    currentUnloadingStop
  });
  
  simulationStateRef.current = { 
    shipment, 
    truckPosition, 
    pathIndex, 
    currentSpeed,
    timeSinceLastStop,
    isCurrentlyStopped,
    stopTimeRemaining,
    isUnloading,
    unloadingTimeRemaining,
    currentUnloadingStop
  };

  useEffect(() => {
    if (detailedFullPath.length === 0) return; // Wait for OSRM route to load
    
    setIsLoading(false);
    
    const simulationTick = async () => {
        // Update traffic and weather data at the start of each simulation tick
        // This ensures position updates and external data are perfectly synchronized
        await updateExternalData();
        
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
        
        // Handle unloading state (at delivery stops)
        if (simulationStateRef.current.isUnloading && simulationStateRef.current.unloadingTimeRemaining > 0) {
          const newUnloadingTime = Math.max(0, simulationStateRef.current.unloadingTimeRemaining - intervalSeconds);
          setUnloadingTimeRemaining(newUnloadingTime);
          
          console.log('📦 Unloading in progress:', {
            stopId: simulationStateRef.current.currentUnloadingStop,
            timeRemaining: Math.round(newUnloadingTime / 60), // minutes
          });
          
          if (newUnloadingTime === 0) {
            // Unloading complete
            console.log('✅ Unloading complete at stop:', simulationStateRef.current.currentUnloadingStop);
            setIsUnloading(false);
            setCurrentUnloadingStop(null);
            
            // Mark stop as completed
            const completedStopId = simulationStateRef.current.currentUnloadingStop;
            if (completedStopId) {
              newShipmentState.longHaulStops = newShipmentState.longHaulStops.map(s => 
                s.id === completedStopId ? { ...s, status: 'Completed' } : s
              );
              newShipmentState.lastMileStops = newShipmentState.lastMileStops.map(s => 
                s.id === completedStopId ? { ...s, status: 'Completed' } : s
              );
              setShipment(newShipmentState);
            }
          }
          return; // Don't move while unloading
        }
        
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
        
        // Get current road segment (use fallback if roadSegments is empty)
        const currentSegment = roadSegments.length > 0 
          ? roadSegments[Math.min(currentPathIndex, roadSegments.length - 1)]
          : { roadType: 'primary', speedLimit: 60, distance: 0.1 }; // Fallback segment
        
        // Use real TomTom traffic speed if available, otherwise calculate realistic speed
        let targetSpeed: number;
        let usingRealTrafficSpeed = false;
        
        if (traffic && traffic.currentSpeed !== undefined && traffic.currentSpeed > 0) {
          // Use real-time speed from TomTom Traffic API
          console.log('🚗 Using real TomTom speed:', traffic.currentSpeed, 'mph');
          targetSpeed = traffic.currentSpeed;
          usingRealTrafficSpeed = true;
          
          // Apply weather multiplier to the real speed (weather still affects driving)
          if (weather) {
            const weatherMultiplier = weather.condition === 'Storm' ? 0.55 : 
                                     weather.condition === 'Rain' ? 0.75 : 1.0;
            targetSpeed = targetSpeed * weatherMultiplier;
          }
          
          // Don't add variation - use exact TomTom speed for accuracy
        } else {
          // Fallback to calculated speed if TomTom data unavailable
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
          
          targetSpeed = addSpeedVariation(speedCalc.adjustedSpeedMph);
        }
        
        // For real traffic speed, use it directly; otherwise apply gradual acceleration
        const newSpeed = usingRealTrafficSpeed ? targetSpeed : applyAcceleration(vehicleSpeed, targetSpeed, intervalSeconds);
        setCurrentSpeed(newSpeed);
        
        // Calculate distance traveled this tick (convert mph to miles per interval)
        const travelDistance = (newSpeed * intervalSeconds) / 3600;
        
        console.log('🚚 Truck movement:', { 
          newSpeed: Math.round(newSpeed), 
          travelDistance: travelDistance.toFixed(4), 
          usingRealTrafficSpeed,
          trafficSpeed: traffic?.currentSpeed 
        });
        
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
                const reachedStop = fullRouteStops[newCurrentLegIndex];
                
                console.log('🎯 Reached stop:', reachedStop.name, 'Type:', reachedStop.type);
                
                // Check if this is a delivery stop (not hub or pickup)
                const isDeliveryStop = reachedStop.type === 'Delivery' || 
                                      newShipmentState.lastMileStops.some(s => s.id === reachedStop.id);
                
                if (isDeliveryStop && !simulationStateRef.current.isUnloading) {
                  // Start unloading process
                  console.log('📦 Starting unloading at:', reachedStop.name);
                  
                  // Find shipment items for this stop
                  const stopItems = newShipmentState.shipmentItems.filter(item => item.destinationStopId === reachedStop.id);
                  
                  if (stopItems.length > 0) {
                    // Use first item's details for unloading prediction
                    const item = stopItems[0];
                    const totalQuantity = stopItems.reduce((sum, i) => sum + i.quantity, 0);
                    
                    console.log('📦 Predicting unloading time for:', item.contents, 'Quantity:', totalQuantity);
                    
                    // Predict unloading time using Gemini AI
                    predictUnloadingTime(item.contents, totalQuantity).then(minutes => {
                      console.log('⏱️ Predicted unloading time:', minutes, 'minutes');
                      
                      // Update stop with unloading time
                      newShipmentState.lastMileStops = newShipmentState.lastMileStops.map(s => 
                        s.id === reachedStop.id 
                          ? { ...s, status: 'Unloading', unloadingTimeMinutes: minutes } 
                          : s
                      );
                      
                      setShipment(newShipmentState);
                      setIsUnloading(true);
                      setUnloadingTimeRemaining(minutes * 60); // Convert to seconds
                      setCurrentUnloadingStop(reachedStop.id);
                    }).catch(error => {
                      console.error('Error predicting unloading time:', error);
                      // Fallback: use default unloading time
                      const fallbackMinutes = 10;
                      newShipmentState.lastMileStops = newShipmentState.lastMileStops.map(s => 
                        s.id === reachedStop.id 
                          ? { ...s, status: 'Unloading', unloadingTimeMinutes: fallbackMinutes } 
                          : s
                      );
                      setShipment(newShipmentState);
                      setIsUnloading(true);
                      setUnloadingTimeRemaining(fallbackMinutes * 60);
                      setCurrentUnloadingStop(reachedStop.id);
                    });
                  }
                } else {
                  // Hub or pickup stop - mark as completed immediately
                  newShipmentState.longHaulStops = newShipmentState.longHaulStops.map(s => 
                    s.id === reachedStop.id ? { ...s, status: 'Completed' } : s
                  );
                  if (newShipmentState.hub.id === reachedStop.id) {
                    newShipmentState.hub = { ...newShipmentState.hub, status: 'Completed' };
                  }
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
        
        // Recalculate ETA every simulation tick (now 60 seconds, synchronized with API updates)
        const now = Date.now();
        
        // Always recalculate since we're now on 60-second intervals matching API updates
        lastEtaCalculation.current = now;
        
        console.log('📊 Recalculating ETA with latest traffic/weather:', { 
            newSpeed, 
            traffic: traffic?.status, 
            weather: weather?.condition,
            nextPathIndex,
            roadSegmentsCount: roadSegments.length 
          });
          
          // Calculate ETA with dynamic speeds
          const etaStop = fullRouteStops[newShipmentState.currentLegIndex + 1];
          console.log('🎯 ETA Stop Check:', {
            currentLegIndex: newShipmentState.currentLegIndex,
            nextStopIndex: newShipmentState.currentLegIndex + 1,
            totalStops: fullRouteStops.length,
            etaStop: etaStop?.name,
            allStops: fullRouteStops.map(s => s.name)
          });
          
          if (etaStop) {
              const etaStopPathIndex = stopPathIndices.get(etaStop.id);
              console.log('📍 ETA Stop Path Index:', {
                stopId: etaStop.id,
                stopName: etaStop.name,
                pathIndex: etaStopPathIndex,
                stopPathIndicesSize: stopPathIndices.size,
                allIndices: Array.from(stopPathIndices.entries())
              });
              
              if (etaStopPathIndex !== undefined) {
                  let remainingDistance = getDistance(newPosition, detailedFullPath[nextPathIndex]);
                  for (let i = nextPathIndex; i < etaStopPathIndex && i < detailedFullPath.length - 1; i++) {
                      remainingDistance += getDistance(detailedFullPath[i], detailedFullPath[i+1]);
                  }
                  
                  // Calculate realistic ETA based on actual current speed and remaining segments
                  let estimatedTime = 0; // minutes
                  
                  if (newSpeed > 0) {
                    // Calculate time based on actual current speed for immediate segment
                    const immediateSegmentDistance = Math.min(remainingDistance, 1); // Next mile
                    estimatedTime += (immediateSegmentDistance / newSpeed) * 60;
                    
                    // For remaining distance, estimate average speed based on road segments
                    const remainingAfterImmediate = Math.max(0, remainingDistance - immediateSegmentDistance);
                    
                    if (remainingAfterImmediate > 0) {
                      // Calculate weighted average speed for remaining segments
                      let totalSegmentDistance = 0;
                      let weightedSpeed = 0;
                      
                      // If we have real TomTom traffic speed, use it for all segments
                      if (usingRealTrafficSpeed && traffic && traffic.currentSpeed) {
                        // Use the current real traffic speed for future segments
                        let effectiveSpeed = traffic.currentSpeed;
                        
                        // Apply weather adjustment
                        if (weather) {
                          const weatherMultiplier = weather.condition === 'Storm' ? 0.55 : 
                                                   weather.condition === 'Rain' ? 0.75 : 1.0;
                          effectiveSpeed = effectiveSpeed * weatherMultiplier;
                        }
                        
                        const avgFutureSpeed = effectiveSpeed;
                        const safeAvgSpeed = Math.max(avgFutureSpeed, 10);
                        estimatedTime += (remainingAfterImmediate / safeAvgSpeed) * 60;
                      } else {
                        // Fallback to calculated speeds if no real traffic data
                        for (let i = nextPathIndex; i < etaStopPathIndex && i < roadSegments.length; i++) {
                          const segment = roadSegments[i];
                          const segmentCalc = calculateRealisticSpeed(segment, traffic, weather, 0);
                          totalSegmentDistance += segment.distance;
                          weightedSpeed += segmentCalc.adjustedSpeedMph * segment.distance;
                        }
                        
                        const avgFutureSpeed = totalSegmentDistance > 0 
                          ? weightedSpeed / totalSegmentDistance 
                          : targetSpeed; // Use current target speed as fallback
                        
                        // Use average speed for remaining distance (minimum 10 mph to avoid infinite ETA)
                        const safeAvgSpeed = Math.max(avgFutureSpeed, 10);
                        estimatedTime += (remainingAfterImmediate / safeAvgSpeed) * 60;
                      }
                    }
                  } else {
                    // If stopped, estimate time assuming will resume at expected speed
                    const estimatedResumeSpeed = targetSpeed || 30; // Use target speed or default
                    estimatedTime = (remainingDistance / estimatedResumeSpeed) * 60;
                  }
                  
                  // Use hybrid ETA calculation (ML + Physics + TomTom)
                  const hybridEta = await getNextStopHybridETA(
                    newPosition,
                    etaStop,
                    roadSegments.slice(nextPathIndex, etaStopPathIndex),
                    remainingDistance,
                    newSpeed,
                    traffic || {} as TrafficData,
                    weather || {} as WeatherData
                  );
                  
                  // Check if the next stop is a delivery stop that requires unloading
                  const isDeliveryStop = newShipmentState.lastMileStops.some(s => s.id === etaStop.id);
                  let unloadingTimeMinutes = 0;
                  
                  if (isDeliveryStop) {
                    // Check if we already have a predicted unloading time for this stop
                    const stopWithUnloadingTime = newShipmentState.lastMileStops.find(s => s.id === etaStop.id);
                    if (stopWithUnloadingTime && stopWithUnloadingTime.unloadingTimeMinutes) {
                      unloadingTimeMinutes = stopWithUnloadingTime.unloadingTimeMinutes;
                      console.log(`⏱️ Using existing unloading time for ${etaStop.name}: ${unloadingTimeMinutes} min`);
                    } else {
                      // Predict unloading time for this stop
                      const stopItems = newShipmentState.shipmentItems.filter(item => item.destinationStopId === etaStop.id);
                      if (stopItems.length > 0) {
                        const item = stopItems[0];
                        const totalQuantity = stopItems.reduce((sum, i) => sum + i.quantity, 0);
                        
                        try {
                          unloadingTimeMinutes = await predictUnloadingTime(item.contents, totalQuantity);
                          console.log(`🤖 Gemini predicted unloading time for ${etaStop.name}: ${unloadingTimeMinutes} min`);
                        } catch (error) {
                          console.warn('⚠️ Failed to predict unloading time, using fallback:', error);
                          unloadingTimeMinutes = 10; // Fallback: 10 minutes
                        }
                      }
                    }
                  }
                  
                  // COMBINED ETA = Road travel time + Unloading time
                  const totalEta = hybridEta + unloadingTimeMinutes;
                  
                  console.log('⏱️ ETA Breakdown:', { 
                    stopName: etaStop.name,
                    roadTravelEta: hybridEta,
                    unloadingTime: unloadingTimeMinutes,
                    totalEta: totalEta,
                    remainingDistance, 
                    newSpeed, 
                    usingRealTrafficSpeed,
                    trafficCurrentSpeed: traffic?.currentSpeed,
                    weatherCondition: weather?.condition
                  });
                  
                  setEta(totalEta);
                  
                  // Update confidence based on conditions
                  let newConfidence = ConfidenceLevel.HIGH;
                  if (weather?.condition === 'Storm' || traffic?.status === 'Heavy') {
                    newConfidence = ConfidenceLevel.LOW;
                  } else if (weather?.condition === 'Rain' || traffic?.status === 'Moderate') {
                    newConfidence = ConfidenceLevel.MEDIUM;
                  }
                  setConfidence(newConfidence);
              } else {
                  console.warn('⚠️ ETA Stop Path Index not found for stop:', etaStop.name);
                  // Fallback: calculate straight-line distance ETA
                  const straightLineDistance = getDistance(newPosition, etaStop.location);
                  const fallbackSpeed = newSpeed > 0 ? newSpeed : 30; // Use current speed or default 30 mph
                  const roadEta = Math.round((straightLineDistance / fallbackSpeed) * 60);
                  
                  // Add unloading time for delivery stops
                  const isDeliveryStop = newShipmentState.lastMileStops.some(s => s.id === etaStop.id);
                  let unloadingTimeMinutes = 0;
                  
                  if (isDeliveryStop) {
                    const stopWithUnloadingTime = newShipmentState.lastMileStops.find(s => s.id === etaStop.id);
                    if (stopWithUnloadingTime && stopWithUnloadingTime.unloadingTimeMinutes) {
                      unloadingTimeMinutes = stopWithUnloadingTime.unloadingTimeMinutes;
                    } else {
                      unloadingTimeMinutes = 10; // Default fallback
                    }
                  }
                  
                  const fallbackEta = roadEta + unloadingTimeMinutes;
                  
                  console.log('📏 Using fallback ETA calculation:', {
                    straightLineDistance: straightLineDistance.toFixed(2),
                    fallbackSpeed,
                    roadEta,
                    unloadingTime: unloadingTimeMinutes,
                    totalFallbackEta: fallbackEta
                  });
                  setEta(fallbackEta);
              }
          } else {
              console.warn('⚠️ No next stop found for ETA calculation');
              setEta(0);
          }
    };
    
    const simulationInterval = setInterval(simulationTick, SIMULATION_INTERVAL_MS);
    
    return () => clearInterval(simulationInterval);
  }, [detailedFullPath, stopPathIndices, fullRouteStops, delayReason, hubIndex, updateExternalData]);

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

  /**
   * Updates the sequence of last mile stops.
   * This will trigger a route recalculation via the useEffect dependent on fullRouteStops.
   */
  const updateStopSequence = useCallback((newLastMileStops: Stop[]) => {
    console.log('🔄 Updating stop sequence in simulation:', newLastMileStops.map(s => s.id));
    setShipment(prev => ({
      ...prev,
      lastMileStops: newLastMileStops
    }));
  }, []);

  /**
   * Switch to a different route while maintaining current truck position
   * The truck will start following the new route from its current location
   */
  const switchRoute = useCallback((newPath: Coordinates[], newSegments: RoadSegment[]) => {
    console.log('🔄 Switching to new route from current truck position');
    console.log(`Current position: [${truckPosition[0].toFixed(4)}, ${truckPosition[1].toFixed(4)}]`);
    console.log(`New route has ${newPath.length} points`);
    
    // Find the closest point on the new route to the current truck position
    let closestIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < newPath.length; i++) {
      const distance = getDistance(truckPosition, newPath[i]);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }
    
    console.log(`Closest point on new route: index ${closestIndex} (${minDistance.toFixed(3)} miles away)`);
    
    // Update the detailed path and segments
    setDetailedFullPath(newPath);
    setRoadSegments(newSegments);
    
    // Update path index to start from the closest point
    setPathIndex(closestIndex);
    
    // Optional: snap truck to the exact route point for accuracy
    setTruckPosition(newPath[closestIndex]);
    
    console.log(`✅ Route switched! Truck will now follow new path from index ${closestIndex}`);
  }, [truckPosition]);

  return { 
    shipment, 
    truckPosition, 
    eta, 
    confidence, 
    traffic, 
    weather, 
    delayReason, 
    // ❌ REMOVED: rerouteSuggestion - use useReroutingEngine hook instead
    isLoading,
    isVisible,
    visibleStops,
    visiblePath,
    lastApiUpdate,
    nextApiUpdate,
    currentSpeed,
    isUnloading,
    unloadingTimeRemaining,
    currentUnloadingStop,
    switchRoute,
    updateStopSequence
  };
};
