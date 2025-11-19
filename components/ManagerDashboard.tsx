import React, { useState, useEffect, useMemo } from 'react';
import { useShipmentData } from '../hooks/useShipmentData';
import { UserRole, ConfidenceLevel, Stop, Shipment } from '../types';
import Map, { OtherShipmentMapData } from './Map';
import StatusCard from './StatusCard';
import Icon from './Icon';
import RouteSelector from './RouteSelector';
import StopSequencer from './StopSequencer';
import { RouteOption, generateAlternativeRoutes } from '../services/multiRouteService';
import { useReroutingEngine } from '../hooks/useReroutingEngine';
import { useLastMileOptimization } from '../hooks/useLastMileOptimization';
import ShipmentTracker, { ShipmentTrackerData } from './ShipmentTracker';

interface ManagerDashboardProps {
  trackingNumber: string;
  shipment: Shipment;
  allShipments: Record<string, Shipment>;
  trackingNumberMap: Record<string, { role: UserRole; shipmentId: string }>;
  onShipmentUpdate: (shipmentId: string, updatedShipment: Shipment) => void;
}

const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ 
  trackingNumber: initialTrackingNumber, 
  shipment: initialShipment,
  allShipments,
  trackingNumberMap,
  onShipmentUpdate
}) => {
  // State for multi-shipment tracking
  const [activeShipmentIds, setActiveShipmentIds] = useState<string[]>([initialShipment.trackingNumber]);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(initialShipment.trackingNumber);
  const [shipmentsData, setShipmentsData] = useState<Record<string, ShipmentTrackerData>>({});
  const [isAddingShipment, setIsAddingShipment] = useState(false);
  const [newTrackingNumber, setNewTrackingNumber] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Get data for the currently selected shipment
  const currentShipmentData = shipmentsData[selectedShipmentId];

  const handleTrackerUpdate = (id: string, data: ShipmentTrackerData) => {
    setShipmentsData(prev => ({
      ...prev,
      [id]: data
    }));
  };

  const handleAddShipment = () => {
    if (!newTrackingNumber) return;
    
    const info = trackingNumberMap[newTrackingNumber];
    if (!info) {
      setAddError('Invalid tracking number');
      return;
    }
    
    const shipmentId = info.shipmentId;
    if (activeShipmentIds.includes(shipmentId)) {
      setAddError('Shipment already added');
      return;
    }

    setActiveShipmentIds(prev => [...prev, shipmentId]);
    setIsAddingShipment(false);
    setNewTrackingNumber('');
    setAddError(null);
  };

  // Prepare data for Map
  const mapData = useMemo(() => {
    // Even if currentShipmentData is missing, we might want to show other shipments?
    // But the map centers on current shipment.
    // Let's return null if current is missing, which is handled by the loading state.
    if (!currentShipmentData) return null;

    const otherShipments: OtherShipmentMapData[] = activeShipmentIds
      .filter(id => id !== selectedShipmentId)
      .map(id => {
        const data = shipmentsData[id];
        // If data is missing for an "other" shipment, just skip it
        if (!data) return null;
        return {
          id,
          truckPosition: data.truckPosition,
          routePath: data.visiblePath,
          stops: data.visibleStops,
          color: '#9ca3af' // Gray
        };
      })
      .filter((s): s is OtherShipmentMapData => s !== null);

    return {
      truckPosition: currentShipmentData.truckPosition,
      routePath: currentShipmentData.visiblePath,
      stops: currentShipmentData.visibleStops,
      otherShipments
    };
  }, [activeShipmentIds, selectedShipmentId, shipmentsData, currentShipmentData]);

  // Multi-route state
  const [availableRoutes, setAvailableRoutes] = useState<RouteOption[]>([]);
  const [activeRouteId, setActiveRouteId] = useState<string>('route-1');
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [currentRouteOption, setCurrentRouteOption] = useState<RouteOption | null>(null);
  const [userSelectedRoute, setUserSelectedRoute] = useState(false); // Track if user manually selected a route
  const [lastLegIndex, setLastLegIndex] = useState<number>(-1); // Track when we move to a new leg
  const [hasFirstUpdate, setHasFirstUpdate] = useState(false); // Track if first 60s update has happened
  const [timeDisplay, setTimeDisplay] = useState({ lastUpdate: '0s ago', nextUpdate: '60s' });

  // Safe defaults for hooks when data is loading
  const safeVisibleStops = currentShipmentData?.visibleStops || [];
  const safeTruckPosition = currentShipmentData?.truckPosition;
  const safeCurrentShipment = currentShipmentData?.shipment;
  const safeUpdateStopSequence = currentShipmentData?.updateStopSequence;

  // Last-mile stop optimization
  const lastMileOpt = useLastMileOptimization({
    stops: safeVisibleStops.filter(s => s.status !== 'Completed'),
    vehiclePosition: safeTruckPosition ? { lat: safeTruckPosition[0], lng: safeTruckPosition[1] } : undefined,
    onSequenceChange: (newSequenceIds) => {
      if (!safeCurrentShipment || !safeUpdateStopSequence) return;

      console.log('📋 Stop sequence updated via optimization/reorder:', newSequenceIds);
      
      // Reconstruct the full lastMileStops list
      // 1. Get completed stops (which were not part of reordering)
      const completedStops = safeCurrentShipment.lastMileStops.filter(s => s.status === 'Completed');
      
      // 2. Map the new sequence IDs back to Stop objects
      const reorderedActiveStops = newSequenceIds
        .map(id => safeCurrentShipment.lastMileStops.find(s => s.id === id))
        .filter((s): s is Stop => s !== undefined);
        
      // 3. Combine completed + reordered active stops
      if (reorderedActiveStops.length > 0) {
        const newLastMileStops = [...completedStops, ...reorderedActiveStops];
        safeUpdateStopSequence(newLastMileStops);
      }
    },
    onOptimizationAccepted: (result) => {
      console.log('✅ Optimization accepted:', result);
    }
  });

  // Track when first update happens - trigger after initial data load (3 seconds grace period)
  useEffect(() => {
    // Set a timer to enable route generation after 3 seconds
    // This gives time for the initial updateExternalData() call to complete
    const timer = setTimeout(() => {
      if (!hasFirstUpdate) {
        setHasFirstUpdate(true);
        console.log('✅ Initial data loaded, enabling route generation');
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, []); // Run once on mount

  // Destructure current data for easier usage with safe defaults
  const { 
    shipment: currentShipment, 
    truckPosition, 
    eta = 0, 
    confidence = ConfidenceLevel.HIGH, 
    traffic = null, 
    weather = null, 
    delayReason = null, 
    visiblePath = [], 
    visibleStops = [], 
    currentSpeed = 0, 
    isUnloading = false, 
    unloadingTimeRemaining = 0, 
    currentUnloadingStop = null, 
    switchRoute,
    updateStopSequence
  } = currentShipmentData || {};

  // Mock missing values that were previously returned by useShipmentData but not in ShipmentTrackerData
  const isLoading = false; 
  const lastApiUpdate = new Date();
  const nextApiUpdate = new Date(Date.now() + 60000);

  // Reset user selection when moving to a new leg
  useEffect(() => {
    if (!currentShipment) return;
    if (currentShipment.currentLegIndex !== lastLegIndex) {
      setUserSelectedRoute(false); // Reset selection for new leg
      setLastLegIndex(currentShipment.currentLegIndex);
      console.log(`🔄 Moved to leg ${currentShipment.currentLegIndex}, resetting route selection`);
    }
  }, [currentShipment?.currentLegIndex, lastLegIndex]);

  // Generate alternative routes
  useEffect(() => {
    // Don't generate routes until after initial data load (3 seconds)
    if (!hasFirstUpdate || !currentShipment) {
      // console.log('⏳ Waiting for initial data load (3s) before generating routes...');
      return;
    }

    const generateRoutes = async () => {
      if (!truckPosition || visibleStops.length === 0) {
        // console.log('⚠️ Cannot generate routes - missing truckPosition or visibleStops', { truckPosition, visibleStopsCount: visibleStops.length });
        return;
      }
      
      const nextStop = visibleStops[currentShipment.currentLegIndex + 1];
      if (!nextStop) {
        // console.log('⚠️ No next stop found for route generation', { currentLegIndex: currentShipment.currentLegIndex, visibleStopsCount: visibleStops.length });
        return;
      }
      
      console.log(`🛣️ Generating routes from [${truckPosition[0].toFixed(4)}, ${truckPosition[1].toFixed(4)}] to ${nextStop.name}`);
      setIsLoadingRoutes(true);
      try {
        const result = await generateAlternativeRoutes(
          truckPosition,
          nextStop.location,
          { includeHighways: true, includeTolls: true, maxAlternatives: 3 }
        );
        
        setAvailableRoutes(result.routes);
        console.log(`✅ Generated ${result.routes.length} routes:`, result.routes.map(r => `${r.id} (${r.metadata.routeType}, ETA: ${r.metadata.currentETAMinutes}min)`));
        console.log(`📍 Recommended route: ${result.recommended}`);
        
        // Only auto-select recommended route if user hasn't manually selected one
        if (!userSelectedRoute) {
          setActiveRouteId(result.recommended);
          const active = result.routes.find(r => r.id === result.recommended);
          setCurrentRouteOption(active || result.routes[0]);
          console.log(`🎯 Auto-selected recommended route: ${result.recommended}`);
        } else {
          // Preserve user's selection - update the route object but keep the same ID
          const userRoute = result.routes.find(r => r.id === activeRouteId);
          if (userRoute) {
            setCurrentRouteOption(userRoute);
            console.log(`🔒 Preserved user-selected route: ${activeRouteId}`);
          } else {
            // If user's selected route no longer exists, fall back to recommended
            setActiveRouteId(result.recommended);
            const active = result.routes.find(r => r.id === result.recommended);
            setCurrentRouteOption(active || result.routes[0]);
            setUserSelectedRoute(false);
            console.log(`⚠️ User route ${activeRouteId} not found, reverted to recommended`);
          }
        }
      } catch (error) {
        console.error('❌ Error generating routes:', error);
      } finally {
        setIsLoadingRoutes(false);
      }
    };
    
    generateRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFirstUpdate, truckPosition, currentShipment?.currentLegIndex, visibleStops]);
  // Note: userSelectedRoute and activeRouteId intentionally excluded to prevent infinite loops

  useEffect(() => {
    const updateTimer = () => {
      if (!lastApiUpdate) return;
      
      const now = new Date();
      const secondsSinceUpdate = Math.floor((now.getTime() - lastApiUpdate.getTime()) / 1000);
      
      const formatTime = (seconds: number) => {
        if (seconds < 60) return `${seconds}s ago`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')} ago`;
      };
      
      setTimeDisplay({
        lastUpdate: formatTime(secondsSinceUpdate),
        nextUpdate: '' // Not used anymore
      });
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lastApiUpdate]);

  // Handle route selection
  const handleRouteSelect = (routeId: string) => {
    setActiveRouteId(routeId);
    setUserSelectedRoute(true); // Mark that user manually selected a route
    const selected = availableRoutes.find(r => r.id === routeId);
    if (selected) {
      setCurrentRouteOption(selected);
      console.log(`🔄 User selected route: ${routeId} (${selected.metadata.routeType})`);
      console.log(`📍 Route locked to user selection - will persist across updates`);
      
      // Switch the simulation to follow the new route from current position
      if (switchRoute) {
        switchRoute(selected.path, selected.segments);
        console.log(`🚛 Truck will now follow the ${selected.metadata.routeType} route from current position`);
      }
    }
  };

  // If we don't have data for the selected shipment yet, show loading
  if (!currentShipmentData || !currentShipment || !truckPosition) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-50" style={{ minHeight: '100vh' }}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading shipment data...</p>
          {/* Render Trackers even while loading */}
          {activeShipmentIds.map(id => {
            const shipment = allShipments[id];
            if (!shipment) return null; // Skip if shipment not found
            return (
              <ShipmentTracker 
                key={id}
                shipment={shipment}
                role={UserRole.MANAGER}
                onUpdate={(data) => handleTrackerUpdate(id, data)}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // Removed redundant isLoading check since we handle loading state above
  // if (isLoading) {
  //   return <div className="text-center p-8">Loading manager dashboard...</div>;
  // }

  const currentLegIndex = currentShipment.currentLegIndex;
  const nextStop = visibleStops[currentLegIndex + 1];

  // Use active route's path if available, otherwise fall back to default visible path
  const displayPath = userSelectedRoute && currentRouteOption 
    ? currentRouteOption.path 
    : visiblePath;

  return (
    <div className="h-full w-full flex flex-col md:flex-row bg-gray-50">
      {/* Sidebar for Shipments */}
      <div className="w-16 md:w-20 bg-gray-900 flex flex-col items-center py-4 space-y-4 shrink-0">
        {activeShipmentIds.map(id => (
          <button
            key={id}
            onClick={() => setSelectedShipmentId(id)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              selectedShipmentId === id ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
            title={`Switch to ${id}`}
          >
            <Icon name="truck" className="h-6 w-6" />
          </button>
        ))}
        <button
          onClick={() => setIsAddingShipment(true)}
          className="w-10 h-10 rounded-full bg-gray-800 text-gray-400 hover:bg-gray-700 flex items-center justify-center border border-gray-600"
          title="Add Shipment"
        >
          <span className="text-2xl font-light text-white">+</span>
        </button>
      </div>

      {/* Map Area */}
      <div className="flex-1 h-1/2 md:h-full relative">
        <Map 
          truckPosition={truckPosition} 
          routePath={displayPath} 
          stops={visibleStops} 
          currentSpeed={currentSpeed} 
          isUnloading={isUnloading}
          unloadingMinutesRemaining={Math.ceil(unloadingTimeRemaining / 60)}
          alternativeRoutes={availableRoutes}
          activeRouteId={activeRouteId}
          onRouteSelect={handleRouteSelect}
          otherShipments={mapData?.otherShipments}
        />
        
        {/* Add Shipment Modal */}
        {isAddingShipment && (
          <div className="absolute top-4 left-4 z-[1000] bg-white p-4 rounded-lg shadow-xl border border-gray-200 w-72">
            <h3 className="font-bold text-gray-800 mb-2">Track Another Shipment</h3>
            <input
              type="text"
              value={newTrackingNumber}
              onChange={(e) => setNewTrackingNumber(e.target.value)}
              placeholder="Enter Tracking Number"
              className="w-full border border-gray-300 rounded px-3 py-2 mb-2 text-sm"
            />
            {addError && <p className="text-red-500 text-xs mb-2">{addError}</p>}
            <div className="flex justify-end space-x-2">
              <button 
                onClick={() => setIsAddingShipment(false)}
                className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
              >
                Cancel
              </button>
              <button 
                onClick={handleAddShipment}
                className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details Panel */}
      <div className="md:w-1/3 h-1/2 md:h-full p-4 overflow-y-auto space-y-4 border-l border-gray-200 bg-white">
        <h2 className="text-2xl font-bold text-gray-800">Manager Dashboard</h2>
        <p className="text-sm text-gray-500 -mt-3 pb-2 border-b">Tracking #{currentShipment.trackingNumber}</p>

        {/* API Update Status */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-3 text-xs">
          <div className="flex items-center space-x-2">
            <div className="animate-pulse h-2 w-2 bg-green-500 rounded-full"></div>
            <Icon name="clock" className="h-4 w-4 text-blue-600" />
            <span className="text-gray-700">Last updated: <span className="font-semibold text-blue-600">{timeDisplay.lastUpdate}</span></span>
          </div>
        </div>

        {/* Unloading Status Banner */}
        {isUnloading && currentUnloadingStop && (
          <div className="bg-gradient-to-r from-orange-100 to-amber-100 border-l-4 border-orange-500 text-orange-900 p-4 rounded-md shadow-lg">
            <div className="flex items-center space-x-2 mb-2">
              <Icon name="truck" className="h-6 w-6 text-orange-600" />
              <p className="font-bold text-lg">📦 Unloading in Progress</p>
            </div>
            <p className="text-sm">
              {(() => {
                const stop = visibleStops.find(s => s.id === currentUnloadingStop);
                const minutes = Math.ceil(unloadingTimeRemaining / 60);
                return `Unloading at ${stop?.name || 'delivery location'} - ${minutes} minutes remaining`;
              })()}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <StatusCard icon="clock" title="ETA to Next Stop" value={`${eta} min`} colorClass="bg-blue-500" subtext={nextStop?.name} />
          <StatusCard icon="pin" title="Confidence" value={confidence} colorClass={confidence === ConfidenceLevel.HIGH ? 'bg-green-500' : 'bg-yellow-500'} />
          <StatusCard icon="traffic" title="Traffic" value={traffic?.status || 'N/A'} colorClass="bg-red-500" subtext={traffic?.description} />
          <StatusCard icon="cloud" title="Weather" value={weather?.condition || 'N/A'} colorClass="bg-purple-500" subtext={weather?.description} />
        </div>
        
        {delayReason && (
          <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-md" role="alert">
            <p className="font-bold">Delay Information</p>
            <p>{delayReason}</p>
          </div>
        )}
        
        {/* Multi-Route Selector */}
        {availableRoutes.length > 0 && (
          <RouteSelector
            routes={availableRoutes}
            activeRouteId={activeRouteId}
            onSelectRoute={handleRouteSelect}
            truckPosition={truckPosition}
          />
        )}
        
        {isLoadingRoutes && (
          <div className="bg-blue-50 border border-blue-200 text-blue-700 p-3 rounded-md text-sm">
            <div className="flex items-center space-x-2">
              <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
              <span>Calculating alternative routes...</span>
            </div>
          </div>
        )}

        {/* Stop Sequencer - Last-Mile Optimization */}
        {currentShipment.status !== 'Delivered' && 
         visibleStops.filter(s => s.status !== 'Completed').length >= 2 && (
          <div className="bg-white p-4 rounded-lg shadow-md">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Icon name="route" className="h-5 w-5 text-indigo-600" />
                <h3 className="font-semibold text-lg">Stop Resequencing</h3>
              </div>
              <button
                onClick={lastMileOpt.requestOptimization}
                disabled={lastMileOpt.isOptimizing}
                className="px-3 py-1 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {lastMileOpt.isOptimizing ? 'Optimizing...' : '✨ Optimize Route'}
              </button>
            </div>
            <StopSequencer
              stops={visibleStops.filter(s => s.status !== 'Completed')}
              onSequenceChange={(newSequence) => {
                console.log('🔄 Manual reorder:', newSequence);
                lastMileOpt.manuallyReorderStops(newSequence);
              }}
              onRequestOptimization={lastMileOpt.requestOptimization}
              optimizationResult={lastMileOpt.optimizationResult}
              onAcceptOptimization={() => {
                console.log('✅ Accepting optimization');
                lastMileOpt.acceptOptimization();
              }}
            />
            {lastMileOpt.error && (
              <div className="mt-2 text-sm text-red-600">
                ⚠️ {lastMileOpt.error}
              </div>
            )}
          </div>
        )}

        <div className="bg-white p-4 rounded-lg shadow-md">
            <h3 className="font-semibold text-lg mb-2">Shipment Details</h3>
            <p><strong>Status:</strong> <span className="font-medium text-indigo-600">{currentShipment.status}</span></p>
            <div className="mt-2">
                <p><strong>Manifest:</strong></p>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 mt-1 pl-2">
                    {currentShipment.shipmentItems.map(item => {
                        const stop = visibleStops.find(s => s.id === item.destinationStopId);
                        return (
                            <li key={item.id}>
                                <span className="font-semibold text-indigo-600">{item.quantity}x</span> {item.contents} <span className="text-gray-500">to {stop?.name || 'Unknown'}</span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-md">
          <h3 className="font-semibold text-lg mb-2">Full Route</h3>
          <ul className="space-y-3">
            {visibleStops.map((stop, index) => {
              const statusText = (() => {
                if (stop.status === 'Unloading') {
                  const minutes = stop.unloadingTimeMinutes || 0;
                  return `Unloading (${minutes} min)`;
                } else if (stop.status === 'Completed') {
                  return 'Completed';
                } else if (index === currentLegIndex + 1) {
                  return 'In Progress';
                } else {
                  return 'Pending';
                }
              })();
              
              const isUnloadingAtThisStop = stop.status === 'Unloading' && stop.id === currentUnloadingStop;
              
              return (
                <li key={stop.id} className="flex items-start">
                  <Icon 
                    name={stop.status === 'Completed' ? 'check-circle' : 'x-circle'} 
                    className={`h-6 w-6 mr-3 mt-1 ${
                      stop.status === 'Completed' ? 'text-green-500' : 
                      isUnloadingAtThisStop ? 'text-orange-500 animate-pulse' : 
                      index === currentLegIndex + 1 ? 'text-blue-500' : 
                      'text-gray-400'
                    }`} 
                  />
                  <div className="flex-1">
                    <p className={`font-medium ${
                      stop.status === 'Completed' ? 'text-gray-500' : 'text-gray-800'
                    }`}>
                      {stop.name}
                    </p>
                    <p className={`text-sm ${
                      isUnloadingAtThisStop ? 'text-orange-600 font-semibold' : 'text-gray-500'
                    }`}>
                      {statusText}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Render Trackers for all active shipments */}
      {activeShipmentIds.map(id => {
        const shipment = allShipments[id];
        if (!shipment) return null;
        return (
          <ShipmentTracker 
            key={id}
            shipment={shipment}
            role={UserRole.MANAGER}
            onUpdate={(data) => handleTrackerUpdate(id, data)}
          />
        );
      })}
    </div>
  );
};

export default ManagerDashboard;
