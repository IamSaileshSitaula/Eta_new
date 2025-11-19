import { Coordinates } from '../types';
import { RoadSegment, analyzeRoadSegment } from './speedSimulationService';

export interface OSRMRouteResponse {
  code: string;
  routes: Array<{
    geometry: {
      coordinates: number[][]; // [lon, lat] format
    };
    duration: number; // seconds
    distance: number; // meters
    legs: Array<{
      duration: number;
      distance: number;
      steps: Array<{
        duration: number;
        distance: number;
        name: string;
        mode: string;
      }>;
    }>;
  }>;
}

export interface EnhancedRouteData {
  path: Coordinates[]; // [lat, lon] format
  segments: RoadSegment[];
  totalDistance: number; // miles
  baseDuration: number; // seconds (from OSRM)
}

/**
 * Fetch route from OSRM API with detailed road information
 * @param coordinates - Array of waypoints [lat, lon]
 * @returns Enhanced route data with road segments
 */
export const fetchOSRMRoute = async (coordinates: Coordinates[]): Promise<EnhancedRouteData> => {
  if (coordinates.length < 2) {
    return {
      path: coordinates,
      segments: [],
      totalDistance: 0,
      baseDuration: 0
    };
  }
  
  try {
    // OSRM expects lon,lat format
    const coordString = coordinates.map(coord => `${coord[1]},${coord[0]}`).join(';');
    
    // Try multiple OSRM servers with timeout
    const servers = [
      'https://routing.openstreetmap.de/routed-car/route/v1/driving',
      'https://router.project-osrm.org/route/v1/driving'
    ];
    
    for (const server of servers) {
      try {
        const url = `${server}/${coordString}?overview=full&geometries=geojson&steps=true`;
        
        console.log(`🗺️ Trying OSRM server: ${server}`);
        
        // Add timeout to fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const data: OSRMRouteResponse = await response.json();
    
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          
          console.log(`✅ Successfully got route from ${server}`);
          
          // Convert geometry to [lat, lon] format
          const path: Coordinates[] = route.geometry.coordinates.map(
            (coord: number[]) => [coord[1], coord[0]] as Coordinates
          );
          
          // Analyze each segment to determine road characteristics
          const segments: RoadSegment[] = [];
          for (let i = 0; i < path.length - 1; i++) {
            const segment = analyzeRoadSegment(path[i], path[i + 1], i, path.length - 1);
            segments.push(segment);
          }
          
          // Convert distance from meters to miles
          const totalDistance = route.distance * 0.000621371;
          
          return {
            path,
            segments,
            totalDistance,
            baseDuration: route.duration
          };
        }
      } catch (serverError) {
        console.warn(`❌ Server ${server} failed:`, serverError);
        // Continue to next server
      }
    }
  } catch (error) {
    console.error('OSRM routing error:', error);
  }
  
  // Fallback to interpolated coordinates if API fails
  // Create a more realistic path by interpolating points along the straight line
  console.warn('⚠️ All OSRM servers failed, using interpolated fallback route');
  
  const interpolatedPath: Coordinates[] = [];
  const segments: RoadSegment[] = [];
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const start = coordinates[i];
    const end = coordinates[i + 1];
    
    // Add start point
    if (i === 0) {
      interpolatedPath.push(start);
    }
    
    // Calculate distance between points
    const lat1 = start[0] * Math.PI / 180;
    const lat2 = end[0] * Math.PI / 180;
    const deltaLat = (end[0] - start[0]) * Math.PI / 180;
    const deltaLon = (end[1] - start[1]) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = 3959 * c; // Earth radius in miles
    
    // Interpolate points (1 point per 5 miles for smoother route)
    const numPoints = Math.max(2, Math.floor(distance / 5));
    
    for (let j = 1; j <= numPoints; j++) {
      const ratio = j / numPoints;
      const lat = start[0] + (end[0] - start[0]) * ratio;
      const lon = start[1] + (end[1] - start[1]) * ratio;
      const prevLat = start[0] + (end[0] - start[0]) * ((j-1) / numPoints);
      const prevLon = start[1] + (end[1] - start[1]) * ((j-1) / numPoints);
      
      interpolatedPath.push([lat, lon]);
      
      // Create road segment
      if (j < numPoints || i < coordinates.length - 1) {
        const segmentDistance = distance / numPoints;
        segments.push({
          start: [prevLat, prevLon] as Coordinates,
          end: [lat, lon] as Coordinates,
          roadType: 'highway', // Assume highway for long distance routes
          speedLimitMph: 70, // Highway speed
          distance: segmentDistance,
          hasTrafficSignal: false
        });
      }
    }
  }
  
  const totalDistance = segments.reduce((sum, seg) => sum + seg.distance, 0);
  
  return {
    path: interpolatedPath,
    segments,
    totalDistance,
    baseDuration: (totalDistance / 60) * 3600 // Estimate at 60 mph
  };
};

/**
 * Get simplified route path (just coordinates) from OSRM
 * Used when detailed segment data is not needed
 */
export const fetchSimpleOSRMRoute = async (coordinates: Coordinates[]): Promise<Coordinates[]> => {
  const enhanced = await fetchOSRMRoute(coordinates);
  return enhanced.path;
};
