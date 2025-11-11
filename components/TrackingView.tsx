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
    visiblePath
  } = useShipmentData(shipment, role, recipientStopId);

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
                    <li key={item.id}>{item.contents}</li>
                ))}
            </ul>
        </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col md:flex-row bg-gray-50">
      <div className="md:w-2/3 h-1/2 md:h-full">
        {isVisible ? (
          <Map truckPosition={truckPosition} routePath={visiblePath} stops={visibleStops} />
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

        <div className="grid grid-cols-2 gap-4">
          <StatusCard icon="clock" title="ETA to Next Stop" value={`${eta} min`} colorClass="bg-blue-500" subtext={nextStop?.name}/>
          <StatusCard icon="pin" title="Confidence" value={confidence} colorClass={confidence === ConfidenceLevel.HIGH ? 'bg-green-500' : 'bg-yellow-500'} />
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
            {visibleStops.map((stop, index) => (
              <li key={stop.id} className="flex items-center">
                <Icon name={index === 0 ? 'truck' : index === visibleStops.length - 1 ? 'flag' : 'pin'} className={`h-6 w-6 mr-3 ${stop.status === 'Completed' ? 'text-green-500' : 'text-gray-400'}`} />
                <div>
                  <p className={`font-medium ${stop.status === 'Completed' ? 'line-through text-gray-500' : 'text-gray-800'}`}>{stop.name}</p>
                  <p className="text-sm text-gray-500">{stop.status}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default TrackingView;
