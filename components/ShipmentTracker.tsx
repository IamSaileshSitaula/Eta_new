import React, { useEffect } from 'react';
import { useShipmentData } from '../hooks/useShipmentData';
import { Shipment, UserRole, Coordinates, Stop, TrafficData, WeatherData, ConfidenceLevel } from '../types';
import { RoadSegment } from '../services/speedSimulationService';

export interface ShipmentTrackerData {
  shipment: Shipment;
  truckPosition: Coordinates;
  eta: number;
  confidence: ConfidenceLevel;
  traffic: TrafficData | null;
  weather: WeatherData | null;
  delayReason: string | null;
  visiblePath: Coordinates[];
  visibleStops: Stop[];
  currentSpeed: number;
  isUnloading: boolean;
  unloadingTimeRemaining: number;
  currentUnloadingStop: string | null;
  switchRoute: (newPath: Coordinates[], newSegments: RoadSegment[]) => void;
  updateStopSequence: (newLastMileStops: Stop[]) => void;
}

interface ShipmentTrackerProps {
  shipment: Shipment;
  role: UserRole;
  onUpdate: (data: ShipmentTrackerData) => void;
}

const ShipmentTracker: React.FC<ShipmentTrackerProps> = ({ shipment, role, onUpdate }) => {
  const data = useShipmentData(shipment, role);

  useEffect(() => {
    if (data) {
      // console.log(`Tracker update for ${shipment.trackingNumber}`, data.truckPosition);
      onUpdate(data);
    }
  }, [
    data.truckPosition, 
    data.eta, 
    data.shipment,
    data.visiblePath,
    data.visibleStops,
    data.isUnloading,
    data.unloadingTimeRemaining,
    data.traffic,
    data.weather,
    data.delayReason,
    data.currentSpeed
  ]);

  return null;
};

export default ShipmentTracker;
