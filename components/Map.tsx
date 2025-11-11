import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Coordinates, Stop } from '../types';

// Custom Truck Icon
const truckIcon = new L.Icon({
    iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzMwNzVmZiI+PHBhdGggZD0iTTIwIDE3LjA2VjE2SDE4LjVBMi41IDIuNSAwIDAwMTYgMTMuNVYxMkg0LjQzQTIgMiAwIDAwMi41IDE0SDJWMTJoMVYxMEgyVjhoMVY2SDJWNGgxMnY4aDQuNUE0LjUgNC41IDAgMDEyMSAxNi41VjE3aDFWMTUuMDZBNi41IDYuNSAwIDAwMTcuNSAxMEgxNFYyaC0ydjJINGEyIDIgMCAwMC0yIDJ2MTBhMiAyIDAgMDAyIDJoMnYzaDJ2LTNoMTB2M2gydi0zaC41QTIuNSAyLjUgMCAwMDIwIDE0LjVWMTcuMDZ6TTcuNSAxN2ExLjUgMS41IDAgMTEwLTMgMS41IDEuNSAwIDAxMCAzem05IDAgMS41IDEuNSAwIDExMC0zIDEuNSAxLjUgMCAwMTAgM3oiLz48L3N2Zz4=',
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
    className: 'shadow-lg rounded-full bg-white p-1'
});

const stopIcon = (color: string) => new L.Icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${encodeURIComponent(color)}'%3e%3cpath d='M12 11.5A2.5 2.5 0 019.5 9A2.5 2.5 0 0112 6.5A2.5 2.5 0 0114.5 9a2.5 2.5 0 01-2.5 2.5zM12 2a7 7 0 00-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 00-7-7z'/%3e%3c/svg%3e`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
});

interface MapProps {
    truckPosition: Coordinates;
    routePath: Coordinates[];
    stops: Stop[];
}

// Component to handle dynamic zoom focusing on truck and destination
const FitBoundsUpdater: React.FC<{ truckPosition: Coordinates; destination: Coordinates }> = ({ truckPosition, destination }) => {
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
            const bounds = L.latLngBounds([truckPosition, destination]);
            
            // Add padding so markers aren't at the edge (industry standard practice)
            map.fitBounds(bounds, {
                padding: [100, 100], // 100px padding on all sides
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
    }, [truckPosition, destination, map, lastTruckPosition, userInteracted]);
    
    return null;
};

const Map: React.FC<MapProps> = ({ truckPosition, routePath, stops }) => {
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
            {/* Route path is already real road data from OSRM (fetched in the hook) */}
            <Polyline positions={routePath} color="#3b82f6" weight={5} opacity={0.8} />
            
            {stops.map((stop, index) => (
                <Marker key={stop.id} position={stop.location} icon={stopIcon(stop.status === 'Completed' ? '#4ade80' : '#9ca3af')}>
                    <Popup>{index + 1}. {stop.name}</Popup>
                </Marker>
            ))}

            <Marker position={truckPosition} icon={truckIcon}>
                <Popup>Current Location</Popup>
            </Marker>
            
            {/* Auto-adjust zoom to show truck and next destination */}
            <FitBoundsUpdater truckPosition={truckPosition} destination={nextDestination} />
        </MapContainer>
    );
};

export default Map;
