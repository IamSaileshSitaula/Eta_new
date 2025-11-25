import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, Stop } from '../types';
import { RouteOption } from '../services/multiRouteService';

// Custom Truck Icon
const truckIcon = new L.Icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round">
            <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
        </svg>
    `),
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
    className: ''
});

const stopIcon = (label: string, color: string) => new L.DivIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: ${color}; width: 24px; height: 24px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; color: white; font-weight: bold; font-size: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${label}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
});

export interface OtherShipmentMapData {
    id: string;
    truckPosition: Coordinates;
    routePath: Coordinates[];
    stops: Stop[];
    color?: string;
}

interface MapProps {
    truckPosition: Coordinates;
    routePath: Coordinates[];
    stops: Stop[];
    currentSpeed?: number;
    isUnloading?: boolean;
    unloadingMinutesRemaining?: number;
    alternativeRoutes?: RouteOption[];
    activeRouteId?: string;
    onRouteSelect?: (routeId: string) => void;
    otherShipments?: OtherShipmentMapData[];
    customStopLabels?: Record<string, string>;
}

// Component to handle dynamic zoom focusing on truck and destination
const FitBoundsUpdater: React.FC<{ truckPosition: Coordinates; destination: Coordinates; otherShipments?: OtherShipmentMapData[] }> = ({ truckPosition, destination, otherShipments }) => {
    const map = useMap();
    const [lastTruckPosition, setLastTruckPosition] = useState<Coordinates | null>(null);
    const [userInteracted, setUserInteracted] = useState(false);

    useEffect(() => {
        // Track user interaction (zoom, pan, etc.)
        const handleUserInteraction = () => {
            setUserInteracted(true);
        };

        map.on('zoomstart', handleUserInteraction);
        map.on('movestart', handleUserInteraction);

        return () => {
            map.off('zoomstart', handleUserInteraction);
            map.off('movestart', handleUserInteraction);
        };
    }, [map]);

    useEffect(() => {
        map.invalidateSize();

        // Only auto-adjust if:
        // 1. First load (lastTruckPosition is null)
        // 2. Truck has moved significantly (>0.001 degrees ~100m)
        // 3. User hasn't manually interacted in the last 3 seconds

        const hasTruckMoved = lastTruckPosition === null ||
            Math.abs(truckPosition[0] - lastTruckPosition[0]) > 0.001 ||
            Math.abs(truckPosition[1] - lastTruckPosition[1]) > 0.001;

        if (hasTruckMoved && !userInteracted) {
            // Create bounds that include both truck and destination
            const points = [truckPosition, destination];

            // Include other shipments in bounds if they exist
            if (otherShipments) {
                otherShipments.forEach(s => {
                    points.push(s.truckPosition);
                });
            }

            const bounds = L.latLngBounds(points);

            // Add padding so markers aren't at the edge (industry standard practice)
            map.fitBounds(bounds, {
                padding: [50, 50], // Reduced padding
                maxZoom: 13, // Don't zoom in too close
                animate: true,
                duration: 1.5
            });

            setLastTruckPosition(truckPosition);
        } else if (hasTruckMoved) {
            // Truck moved but user is interacting - just update position without auto-zoom
            setLastTruckPosition(truckPosition);
        }

        // Reset user interaction flag after 5 seconds of truck movement
        if (userInteracted && hasTruckMoved) {
            const timeout = setTimeout(() => {
                setUserInteracted(false);
            }, 5000);
            return () => clearTimeout(timeout);
        }
    }, [truckPosition, destination, map, lastTruckPosition, userInteracted, otherShipments]);

    return null;
};

const Map: React.FC<MapProps> = ({
    truckPosition,
    routePath,
    stops,
    currentSpeed,
    isUnloading,
    unloadingMinutesRemaining,
    alternativeRoutes = [],
    activeRouteId,
    onRouteSelect,
    otherShipments = [],
    customStopLabels = {}
}) => {
    // routePath now comes from the hook which already fetched it from OSRM

    if (routePath.length === 0) {
        return <div className="flex items-center justify-center h-full bg-gray-200"><p>Route data not available.</p></div>
    }

    // Find the next destination (first pending stop or last stop)
    const nextDestination = stops.find(stop => stop.status === 'Pending')?.location || stops[stops.length - 1]?.location || routePath[routePath.length - 1];

    const bounds = L.latLngBounds(routePath);

    return (
        <MapContainer
            center={routePath[0]}
            bounds={bounds}
            scrollWheelZoom={true}
            zoomControl={true}
            className="h-full w-full z-0"
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Alternative routes (green) - render first so active route is on top */}
            {alternativeRoutes.map((route) => {
                const isActive = route.id === activeRouteId;

                // Render all routes - alternatives in green, active will be overlaid in blue
                if (isActive) return null; // Active route rendered separately below

                return (
                    <Polyline
                        key={route.id}
                        positions={route.path}
                        color="#22c55e"
                        weight={5}
                        opacity={0.6}
                        dashArray="8, 8"
                        eventHandlers={{
                            click: () => {
                                console.log(`🗺️ Clicked alternative route: ${route.id}`);
                                if (onRouteSelect) {
                                    onRouteSelect(route.id);
                                }
                            },
                            mouseover: (e) => {
                                e.target.setStyle({ opacity: 0.9, weight: 6 });
                            },
                            mouseout: (e) => {
                                e.target.setStyle({ opacity: 0.6, weight: 5 });
                            }
                        }}
                    >
                        <Popup>
                            <div className="text-center">
                                <div className="font-bold text-sm mb-1">
                                    {route.metadata.routeType === 'toll-free' ? '🚫 Toll-Free Route' :
                                        route.metadata.routeType === 'fastest' ? '⚡ Fastest Route' :
                                            route.metadata.routeType === 'shortest' ? '📏 Shortest Route' :
                                                '⚖️ Balanced Route'}
                                </div>
                                <div className="text-xs text-gray-600">
                                    ETA: {route.metadata.currentETAMinutes} min
                                </div>
                                <div className="text-xs text-blue-600 mt-1 cursor-pointer hover:underline">
                                    Click to select this route
                                </div>
                            </div>
                        </Popup>
                    </Polyline>
                );
            })}

            {/* Active route path (bold blue) - render on top */}
            <Polyline
                positions={routePath}
                color="#3b82f6"
                weight={5}
                opacity={0.9}
            >
                <Popup>
                    <div className="text-center">
                        <div className="font-bold text-sm text-blue-600 mb-1">
                            ✓ Active Route
                        </div>
                        <div className="text-xs text-gray-600">
                            Currently following this route
                        </div>
                    </div>
                </Popup>
            </Polyline>

            {stops.map((stop, index) => {
                const label = customStopLabels[stop.id] || (index + 1).toString();
                return (
                    <Marker key={stop.id} position={stop.location} icon={stopIcon(label, stop.status === 'Completed' ? '#4ade80' : '#9ca3af')}>
                        <Popup>{label}. {stop.name}</Popup>
                    </Marker>
                );
            })}

            <Marker position={truckPosition} icon={truckIcon}>
                <Popup>
                    <div className="text-center">
                        <div className="font-bold text-sm mb-1">
                            {isUnloading ? '📦 Unloading' : 'Current Location'}
                        </div>
                        {isUnloading && unloadingMinutesRemaining !== undefined && (
                            <div className="text-orange-600 font-semibold mb-2">
                                ⏱️ {unloadingMinutesRemaining} min remaining
                            </div>
                        )}
                        {currentSpeed !== undefined && !isUnloading && (
                            <div className="text-blue-600 font-semibold">
                                🚗 {Math.round(currentSpeed)} mph
                            </div>
                        )}
                    </div>
                </Popup>
            </Marker>

            {/* Auto-adjust zoom to show truck and next destination */}
            <FitBoundsUpdater truckPosition={truckPosition} destination={nextDestination} otherShipments={otherShipments} />

            {/* Render Other Shipments */}
            {otherShipments.map((shipment) => (
                <React.Fragment key={shipment.id}>
                    {/* Route Path for Other Shipment */}
                    <Polyline
                        positions={shipment.routePath}
                        color={shipment.color || '#9ca3af'} // Default gray
                        weight={4}
                        opacity={0.6}
                        dashArray="5, 10"
                    />

                    {/* Truck Marker for Other Shipment */}
                    <Marker
                        position={shipment.truckPosition}
                        icon={truckIcon}
                        opacity={0.7}
                    >
                        <Popup>
                            <div className="p-2">
                                <h3 className="font-bold text-gray-800">Shipment {shipment.id}</h3>
                                <p className="text-sm text-gray-600">Tracking...</p>
                            </div>
                        </Popup>
                    </Marker>
                </React.Fragment>
            ))}


        </MapContainer>
    );
};

export default Map;
