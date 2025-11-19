/**
 * Reroute Notification Component
 * Displays reroute suggestions with accept/reject controls
 */

import React, { useState } from 'react';
import { RerouteEvaluation } from '../hooks/useReroutingEngine';
import { RouteOption } from '../services/multiRouteService';
import Icon from './Icon';

interface RerouteNotificationProps {
  evaluation: RerouteEvaluation;
  currentRoute: RouteOption;
  onAccept: () => void;
  onReject: () => void;
}

const RerouteNotification: React.FC<RerouteNotificationProps> = ({
  evaluation,
  currentRoute,
  onAccept,
  onReject
}) => {
  const [showDetails, setShowDetails] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const handleAccept = async () => {
    setIsProcessing(true);
    await onAccept();
    setIsProcessing(false);
  };
  
  const handleReject = () => {
    onReject();
  };
  
  return (
    <div className="reroute-notification bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-indigo-600 p-4 rounded-lg shadow-lg animate-slide-down">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3 flex-1">
          <div className="bg-indigo-600 p-2 rounded-full">
            <Icon name="zap" className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <p className="font-bold text-indigo-900 text-lg">Faster Route Available</p>
              <span className={`text-xs px-2 py-1 rounded ${
                evaluation.confidence === 'High' 
                  ? 'bg-green-100 text-green-700' 
                  : evaluation.confidence === 'Medium'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {evaluation.confidence} Confidence
              </span>
            </div>
            <p className="text-indigo-700 mb-1">
              Save <span className="font-bold text-xl text-indigo-900">{Math.round(evaluation.timeSavings)}</span> minutes by switching routes
            </p>
            <p className="text-sm text-gray-600">{evaluation.reason}</p>
          </div>
        </div>
        
        <button 
          onClick={() => setShowDetails(!showDetails)} 
          className="text-indigo-600 hover:text-indigo-800 p-1"
        >
          <Icon 
            name={showDetails ? 'chevron-up' : 'chevron-down'} 
            className="h-5 w-5" 
          />
        </button>
      </div>
      
      {showDetails && (
        <div className="mt-4 space-y-3 border-t border-indigo-200 pt-4">
          {/* Comparison Table */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
              <p className="text-xs text-gray-500 mb-2 flex items-center">
                <Icon name="route" className="h-3 w-3 mr-1" />
                Current Route
              </p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">ETA:</span>
                  <span className="font-bold text-gray-900">{evaluation.comparisonData.currentETA} min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Distance:</span>
                  <span className="font-medium">{evaluation.comparisonData.currentDistance.toFixed(1)} mi</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Type:</span>
                  <span className="font-medium capitalize">{currentRoute.metadata.routeType}</span>
                </div>
              </div>
            </div>
            
            <div className="bg-indigo-50 p-3 rounded-lg border-2 border-indigo-300 shadow-sm">
              <p className="text-xs text-indigo-700 mb-2 flex items-center font-semibold">
                <Icon name="zap" className="h-3 w-3 mr-1" />
                New Route
              </p>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-indigo-600">ETA:</span>
                  <span className="font-bold text-indigo-900">{evaluation.comparisonData.newETA} min</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-indigo-600">Distance:</span>
                  <span className="font-medium text-indigo-800">{evaluation.comparisonData.newDistance.toFixed(1)} mi</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-indigo-600">Type:</span>
                  <span className="font-medium capitalize text-indigo-800">{evaluation.newRoute.metadata.routeType}</span>
                </div>
              </div>
            </div>
          </div>
          
          {/* Historical Accuracy */}
          <div className="bg-white p-3 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center space-x-2">
                <Icon name="activity" className="h-4 w-4 text-gray-500" />
                <span className="text-gray-700">Historical Accuracy:</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="bg-gray-200 h-2 w-24 rounded-full overflow-hidden">
                  <div 
                    className="bg-green-500 h-full rounded-full"
                    style={{ width: `${evaluation.historicalAccuracy}%` }}
                  />
                </div>
                <span className="font-bold text-gray-900">{evaluation.historicalAccuracy.toFixed(0)}%</span>
              </div>
            </div>
          </div>
          
          {/* Live Conditions */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center space-x-2 bg-white p-2 rounded border border-gray-200">
              <Icon name="traffic" className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-gray-500">Traffic:</p>
                <p className="font-medium">{evaluation.newRoute.liveConditions.currentTrafficLevel}</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 bg-white p-2 rounded border border-gray-200">
              <Icon name="cloud" className="h-4 w-4 text-gray-500" />
              <div>
                <p className="text-gray-500">Weather:</p>
                <p className="font-medium">{evaluation.newRoute.liveConditions.weatherCondition}</p>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Action Buttons */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={handleAccept}
          disabled={isProcessing}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center space-x-2"
        >
          {isProcessing ? (
            <>
              <Icon name="spinner" className="h-5 w-5 animate-spin" />
              <span>Switching Route...</span>
            </>
          ) : (
            <>
              <Icon name="check-circle" className="h-5 w-5" />
              <span>Accept New Route</span>
            </>
          )}
        </button>
        <button
          onClick={handleReject}
          disabled={isProcessing}
          className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-3 px-4 rounded-lg transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
        >
          <Icon name="x-circle" className="h-5 w-5" />
          <span>Keep Current</span>
        </button>
      </div>
    </div>
  );
};

export default RerouteNotification;
