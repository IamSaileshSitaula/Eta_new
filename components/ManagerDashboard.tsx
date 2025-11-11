import React from 'react';
import { useShipmentData } from '../hooks/useShipmentData';
import { UserRole, ConfidenceLevel, Stop, Shipment } from '../types';
import Map from './Map';
import StatusCard from './StatusCard';
import Icon from './Icon';

interface ManagerDashboardProps {
  trackingNumber: string;
  shipment: Shipment;
}

const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ trackingNumber, shipment }) => {
  const { 
    shipment: currentShipment, 
    truckPosition, 
    eta, 
    confidence, 
    traffic, 
    weather, 
    delayReason, 
    rerouteSuggestion,
    isLoading,
    visiblePath,
    visibleStops
  } = useShipmentData(shipment, UserRole.MANAGER);

  if (isLoading) {
    return <div className="text-center p-8">Loading manager dashboard...</div>;
  }

  const currentLegIndex = currentShipment.currentLegIndex;
  const nextStop = visibleStops[currentLegIndex + 1];

  return (
    <div className="h-full w-full flex flex-col md:flex-row bg-gray-50">
      <div className="md:w-2/3 h-1/2 md:h-full">
        <Map truckPosition={truckPosition} routePath={visiblePath} stops={visibleStops} />
      </div>
      <div className="md:w-1/3 h-1/2 md:h-full p-4 overflow-y-auto space-y-4">
        <h2 className="text-2xl font-bold text-gray-800">Manager Dashboard</h2>
        <p className="text-sm text-gray-500 -mt-3 pb-2 border-b">Tracking #{trackingNumber}</p>

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
        
        {rerouteSuggestion && (
          <div className="bg-indigo-100 border-l-4 border-indigo-500 text-indigo-700 p-4 rounded-md shadow-lg">
            <p className="font-bold">Reroute Suggestion</p>
            <p className="my-2">{rerouteSuggestion.reason} Save approx. {rerouteSuggestion.timeSavingsMinutes} min.</p>
            <button className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded transition-colors w-full">
              Accept Reroute
            </button>
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
                                {item.contents} <span className="text-gray-500">to {stop?.name || 'Unknown'}</span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-md">
          <h3 className="font-semibold text-lg mb-2">Full Route</h3>
          <ul className="space-y-3">
            {visibleStops.map((stop, index) => (
              <li key={stop.id} className="flex items-start">
                <Icon name={index === 0 ? 'truck' : (index === visibleStops.length - 1) ? 'flag' : 'pin'} className={`h-6 w-6 mr-3 mt-1 ${index <= currentLegIndex ? 'text-green-500' : 'text-gray-400'}`} />
                <div>
                  <p className={`font-medium ${index <= currentLegIndex ? 'line-through text-gray-500' : 'text-gray-800'}`}>{stop.name}</p>
                  <p className="text-sm text-gray-500">{index <= currentLegIndex ? 'Completed' : (index === currentLegIndex + 1 ? 'In Progress' : 'Pending')}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default ManagerDashboard;
