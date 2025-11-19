import React from 'react';
import { useShipmentData } from '../hooks/useShipmentData';
import { UserRole, ConfidenceLevel, Stop, Shipment } from '../types';
import Map from './Map';
import StatusCard from './StatusCard';
import Icon from './Icon';

interface TrackingViewProps {
  trackingNumber: string;
  role: UserRole;
  shipment: Shipment;
  recipientStopId?: string;
}

const TrackingView: React.FC<TrackingViewProps> = ({ trackingNumber, role, shipment, recipientStopId }) => {
  const { 
    shipment: currentShipment, 
    truckPosition, 
    eta, 
    confidence, 
    delayReason, 
    isLoading,
    isVisible,
    visibleStops,
    visiblePath,
    lastApiUpdate,
    nextApiUpdate,
    traffic,
    weather,
    currentSpeed,
    isUnloading,
    unloadingTimeRemaining,
    currentUnloadingStop
  } = useShipmentData(shipment, role, recipientStopId);

  // Calculate time since last update and time until next update
  const [timeDisplay, setTimeDisplay] = React.useState({ lastUpdate: '0s ago', nextUpdate: '60s' });

  React.useEffect(() => {
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

  if (isLoading) {
    return <div className="text-center p-8">Loading shipment data...</div>;
  }
  
  const nextStop = visibleStops.find(stop => stop.status !== 'Completed');

  const renderShipmentContents = () => {
    if (role === UserRole.RECIPIENT && recipientStopId) {
        const recipientShipment = currentShipment.shipmentItems.find(
            item => item.destinationStopId === recipientStopId
        );
        return <p><strong>Your Delivery:</strong> {recipientShipment?.contents || 'N/A'}</p>;
    }
    
    if (currentShipment.shipmentItems.length === 0) {
        return <p><strong>Contents:</strong> No items listed.</p>;
    }

    return (
        <div>
            <p><strong>Manifest Summary:</strong></p>
            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 mt-1 pl-2">
                {currentShipment.shipmentItems.map(item => (
                    <li key={item.id}>
                        <span className="font-semibold text-indigo-600">{item.quantity}x</span> {item.contents}
                    </li>
                ))}
            </ul>
        </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col md:flex-row bg-gray-50">
      <div className="md:w-2/3 h-1/2 md:h-full">
        {isVisible ? (
          <Map 
            truckPosition={truckPosition} 
            routePath={visiblePath} 
            stops={visibleStops} 
            currentSpeed={currentSpeed}
            isUnloading={isUnloading}
            unloadingMinutesRemaining={Math.ceil(unloadingTimeRemaining / 60)}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gray-200">
              <div className="text-center p-4 bg-white rounded-lg shadow-lg">
                  <Icon name="truck" className="h-12 w-12 mx-auto text-gray-400 mb-4"/>
                  <h2 className="text-xl font-semibold text-gray-700">Awaiting Your Shipment Segment</h2>
                  <p className="text-gray-500 mt-2">
                    {role === UserRole.SUPPLIER ? "The shipment has left the distribution hub. Your tracking view has ended." : "Your delivery segment has not yet begun. The map will become active when the truck is en route to you."}
                  </p>
              </div>
          </div>
        )}
      </div>
      <div className="md:w-1/3 h-1/2 md:h-full p-4 overflow-y-auto space-y-4">
        <h2 className="text-2xl font-bold text-gray-800">Tracking #{trackingNumber}</h2>
        <p className="text-sm text-gray-500 -mt-3 pb-2 border-b">Role: {role}</p>

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
          <StatusCard icon="clock" title="ETA to Next Stop" value={`${eta} min`} colorClass="bg-blue-500" subtext={nextStop?.name}/>
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

        <div className="bg-white p-4 rounded-lg shadow-md">
            <h3 className="font-semibold text-lg mb-2">Shipment Details</h3>
            {renderShipmentContents()}
            <p className="mt-2"><strong>Status:</strong> <span className="font-medium text-indigo-600">{currentShipment.status}</span></p>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-md">
          <h3 className="font-semibold text-lg mb-2">Route for You</h3>
          <ul className="space-y-3">
            {visibleStops.map((stop, index) => {
              const statusText = (() => {
                if (stop.status === 'Unloading') {
                  const minutes = stop.unloadingTimeMinutes || 0;
                  return `Unloading (${minutes} min)`;
                } else {
                  return stop.status;
                }
              })();
              
              const isUnloadingAtThisStop = stop.status === 'Unloading' && stop.id === currentUnloadingStop;
              
              return (
                <li key={stop.id} className="flex items-center">
                  <Icon 
                    name={stop.status === 'Completed' ? 'check-circle' : 'x-circle'} 
                    className={`h-6 w-6 mr-3 ${
                      stop.status === 'Completed' ? 'text-green-500' : 
                      isUnloadingAtThisStop ? 'text-orange-500 animate-pulse' : 
                      'text-gray-400'
                    }`} 
                  />
                  <div>
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
    </div>
  );
};

export default TrackingView;
