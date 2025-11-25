/**
 * Route Selector Component
 * Displays and allows selection of alternative routes
 */

import React, { useState } from 'react';
import { RouteOption } from '../services/multiRouteService';
import { Coordinates } from '../types';
import Icon from './Icon';

interface RouteSelectorProps {
  routes: RouteOption[];
  activeRouteId: string;
  recommendedRouteId?: string;
  onSelectRoute: (routeId: string) => void;
  truckPosition: Coordinates;
  currentETA?: number; // Current ETA in minutes from main calculation
  trafficData?: any;
  weatherData?: any;
}

const RouteSelector: React.FC<RouteSelectorProps> = ({
  routes,
  activeRouteId,
  recommendedRouteId,
  onSelectRoute,
  truckPosition,
  currentETA,
  trafficData,
  weatherData
}) => {
  const [expanded, setExpanded] = useState(false);
  
  const activeRoute = routes.find(r => r.id === activeRouteId) || routes[0];
  
  if (routes.length === 1) {
    // Don't show selector if only one route
    return null;
  }
  
  return (
    <div className="route-selector bg-white rounded-lg shadow-md overflow-hidden">
      {/* Compact view: Show active route + toggle */}
      <div 
        className="active-route-bar bg-indigo-600 text-white p-3 flex justify-between items-center cursor-pointer hover:bg-indigo-700 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center space-x-3">
          <Icon name="route" className="h-5 w-5" />
          <div>
            <span className="font-bold capitalize">{activeRoute.metadata.routeType} Route</span>
            <span className="ml-2 text-indigo-200">•</span>
            <span className="ml-2 text-sm">ETA: {(() => {
              const etaMinutes = currentETA !== undefined ? currentETA : activeRoute.metadata.currentETAMinutes;
              const arrivalTime = new Date(Date.now() + etaMinutes * 60 * 1000);
              const formattedTime = arrivalTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              return `${formattedTime} (${Math.round(etaMinutes)}m)`;
            })()}</span>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-sm bg-indigo-500 px-2 py-1 rounded">
            {routes.length - 1} alternative{routes.length > 2 ? 's' : ''}
          </span>
          <Icon 
            name="chevron-down" 
            className={`h-5 w-5 transition-transform ${expanded ? 'rotate-180' : ''}`} 
          />
        </div>
      </div>
      
      {/* Expanded view: All routes comparison */}
      {expanded && (
        <div className="routes-grid p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.map((route) => (
              <RouteCard
                key={route.id}
                route={route}
                isActive={route.id === activeRouteId}
                recommendedRouteId={recommendedRouteId}
                currentETA={currentETA}
                trafficData={trafficData}
                weatherData={weatherData}
                onSelect={() => {
                  console.log(`✅ User clicked route: ${route.id} (${route.metadata.routeType})`);
                  onSelectRoute(route.id);
                  // Delay closing to ensure selection completes
                  setTimeout(() => setExpanded(false), 100);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

interface RouteCardProps {
  route: RouteOption;
  isActive: boolean;
  recommendedRouteId?: string;
  currentETA?: number;
  trafficData?: any;
  weatherData?: any;
  onSelect: () => void;
}

const RouteCard: React.FC<RouteCardProps> = ({ route, isActive, recommendedRouteId, currentETA, trafficData, weatherData, onSelect }) => {
  const liveTraffic = trafficData?.status || route.liveConditions.currentTrafficLevel;
  const liveWeather = weatherData?.condition || route.liveConditions.weatherCondition;
  const weatherDescription = weatherData?.description || route.liveConditions.weatherCondition;

  return (
    <div 
      className={`route-card border-2 rounded-lg p-4 cursor-pointer transition-all hover:shadow-lg ${
        isActive 
          ? 'border-indigo-600 bg-indigo-50 shadow-md' 
          : 'border-gray-300 hover:border-indigo-400 bg-white'
      }`}
      onClick={onSelect}
    >
      <div className="flex justify-between items-start mb-3">
        <div>
          <span className="font-bold text-lg capitalize">{route.metadata.routeType}</span>
          {route.id === recommendedRouteId && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
              Recommended
            </span>
          )}
        </div>
        {isActive && (
          <Icon name="check-circle" className="h-6 w-6 text-green-500 flex-shrink-0" />
        )}
      </div>
      
      <div className="space-y-2 text-sm mb-3">
        <div className="flex justify-between items-center">
          <span className="text-gray-600">ETA:</span>
          <span className="font-bold text-lg text-indigo-600">
            {(() => {
              // Use unified currentETA for active route, route-specific for alternatives
              const etaMinutes = isActive && currentETA !== undefined ? currentETA : route.metadata.currentETAMinutes;
              
              // Debug: Log if ETA seems wrong
              if (etaMinutes > 1000 || etaMinutes < 0) {
                console.warn(`⚠️ Route ${route.id} has suspicious ETA: ${etaMinutes} minutes`);
              }
              
              const arrivalTime = new Date(Date.now() + etaMinutes * 60 * 1000);
              const formattedTime = arrivalTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              
              // Also show the raw minutes for debugging
              return `${formattedTime} (${Math.round(etaMinutes)} min)`;
            })()}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Distance:</span>
          <span className="font-medium">{route.metadata.totalDistanceMiles.toFixed(1)} mi</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Fuel Cost:</span>
          <span className="font-medium text-gray-800">
            ${route.metadata.fuelCost?.toFixed(2) || '0.00'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Highway:</span>
          <span className="font-medium">
            {Math.round((route.metadata.highwayMiles / route.metadata.totalDistanceMiles) * 100)}%
          </span>
        </div>
        {route.metadata.tollRoadMiles > 0 && (
          <div className="flex justify-between text-yellow-700">
            <span className="flex items-center">
              <Icon name="alert-triangle" className="h-4 w-4 mr-1" />
              Tolls:
            </span>
            <span className="font-medium">{route.metadata.tollRoadMiles.toFixed(1)} mi</span>
          </div>
        )}
      </div>
      
      <div className="flex gap-2 mb-3">
        <RiskBadge label="Traffic" score={route.metadata.trafficRiskScore} />
        <WeatherBadge condition={liveWeather} />
      </div>
      
      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-200">
        <div className="flex items-center space-x-1">
          <Icon name="shield-check" className="h-3 w-3" />
          <span>Confidence: {route.liveConditions.confidence}</span>
        </div>
        <span>{liveTraffic} traffic</span>
      </div>
      {weatherDescription && (
        <div className="text-xxs text-gray-500 mt-1">{weatherDescription}</div>
      )}
    </div>
  );
};

interface RiskBadgeProps {
  label: string;
  score: number;
}

const RiskBadge: React.FC<RiskBadgeProps> = ({ label, score }) => {
  const getColor = () => {
    if (score < 0.3) return 'bg-green-100 text-green-700 border-green-300';
    if (score < 0.6) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    return 'bg-red-100 text-red-700 border-red-300';
  };
  
  const getLabel = () => {
    if (score < 0.3) return 'Low';
    if (score < 0.6) return 'Med';
    return 'High';
  };
  
  return (
    <div className={`flex items-center space-x-1 px-2 py-1 rounded border text-xs ${getColor()}`}>
      <span className="font-medium">{label}:</span>
      <span>{getLabel()}</span>
    </div>
  );
};

interface WeatherBadgeProps {
  condition?: string;
}

const WeatherBadge: React.FC<WeatherBadgeProps> = ({ condition }) => {
  const getWeatherDisplay = () => {
    const normalized = condition?.toString().toLowerCase() || 'clear';
    
    // Severe conditions
    if (normalized.includes('storm') || normalized.includes('thunder') || normalized.includes('severe')) {
      return { color: 'bg-red-100 text-red-700 border-red-300', label: 'Storm', icon: '⛈️' };
    }
    // Rain/Snow
    if (normalized.includes('rain') || normalized.includes('drizzle') || normalized.includes('shower')) {
      return { color: 'bg-blue-100 text-blue-700 border-blue-300', label: 'Rain', icon: '🌧️' };
    }
    if (normalized.includes('snow') || normalized.includes('sleet') || normalized.includes('ice')) {
      return { color: 'bg-blue-100 text-blue-700 border-blue-300', label: 'Snow', icon: '🌨️' };
    }
    // Cloudy/Fog
    if (normalized.includes('cloud') || normalized.includes('overcast') || normalized.includes('fog') || normalized.includes('mist')) {
      return { color: 'bg-gray-100 text-gray-700 border-gray-300', label: 'Cloudy', icon: '☁️' };
    }
    // Clear/Good
    return { color: 'bg-green-100 text-green-700 border-green-300', label: 'Clear', icon: '☀️' };
  };
  
  const { color, label, icon } = getWeatherDisplay();
  
  return (
    <div className={`flex items-center space-x-1 px-2 py-1 rounded border text-xs ${color}`}>
      <span>{icon}</span>
      <span className="font-medium">Weather:</span>
      <span>{label}</span>
    </div>
  );
};

export default RouteSelector;
