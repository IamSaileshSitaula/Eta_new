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
  onSelectRoute: (routeId: string) => void;
  truckPosition: Coordinates;
}

const RouteSelector: React.FC<RouteSelectorProps> = ({
  routes,
  activeRouteId,
  onSelectRoute,
  truckPosition
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
            <span className="ml-2 text-sm">ETA: {activeRoute.metadata.currentETAMinutes} min</span>
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
                onSelect={() => {
                  onSelectRoute(route.id);
                  setExpanded(false);
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
  onSelect: () => void;
}

const RouteCard: React.FC<RouteCardProps> = ({ route, isActive, onSelect }) => {
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
          {route.id === 'route-1' && (
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
            {route.metadata.currentETAMinutes} min
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Distance:</span>
          <span className="font-medium">{route.metadata.totalDistanceMiles.toFixed(1)} mi</span>
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
        <RiskBadge label="Weather" score={route.metadata.weatherRiskScore} />
      </div>
      
      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-200">
        <div className="flex items-center space-x-1">
          <Icon name="shield-check" className="h-3 w-3" />
          <span>Confidence: {route.liveConditions.confidence}</span>
        </div>
        <span>{route.liveConditions.currentTrafficLevel} traffic</span>
      </div>
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

export default RouteSelector;
