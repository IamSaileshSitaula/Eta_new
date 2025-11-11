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
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true`;
    
    const response = await fetch(url);
    const data: OSRMRouteResponse = await response.json();
    
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      
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
  } catch (error) {
    console.error('OSRM routing error:', error);
  }
  
  // Fallback to original coordinates if API fails
  return {
    path: coordinates,
    segments: [],
    totalDistance: 0,
    baseDuration: 0
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
