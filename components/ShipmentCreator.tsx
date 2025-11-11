import React, { useState, useMemo } from 'react';
import { Shipment, ShipmentStatus, Stop, Coordinates, ShipmentItem } from '../types';
import Icon from './Icon';

interface ShipmentCreatorProps {
    onShipmentCreated: (shipment: Shipment) => void;
    onBack: () => void;
}

type VerificationStatus = 'idle' | 'loading' | 'verified' | 'error';
type EditableStop = {
    id: string;
    name: string;
    coords: Coordinates | null;
    status: VerificationStatus;
    contents?: string; // Optional for long-haul, required for last-mile
}

const ShipmentCreator: React.FC<ShipmentCreatorProps> = ({ onShipmentCreated, onBack }) => {
    const [origin, setOrigin] = useState<EditableStop>({id: 'stop-0', name: 'Austin, TX', coords: null, status: 'idle'});
    const [longHaulStops, setLongHaulStops] = useState<EditableStop[]>([]);
    const [hub, setHub] = useState<EditableStop>({id: 'stop-1', name: 'Beaumont, TX', coords: null, status: 'idle'});
    const [lastMileStops, setLastMileStops] = useState<EditableStop[]>([
        {id: `stop-2`, name: 'Port Arthur, TX', coords: null, status: 'idle', contents: '10 Mattresses'}
    ]);
    const [isLastMileOnly, setIsLastMileOnly] = useState(false);

    const geocodeAddress = async (address: string): Promise<Coordinates | null> => {
        if (!address.trim()) return null;
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
            const data = await response.json();
            if (data && data.length > 0) {
                return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
            }
            return null;
        } catch (error) {
            console.error("Geocoding error:", error);
            return null;
        }
    };
    
    const handleVerify = async (stopType: 'origin' | 'hub' | 'longHaul' | 'lastMile', index?: number) => {
        let stopToVerify: EditableStop | undefined;
        let setStopState: React.Dispatch<React.SetStateAction<any>>;

        if (stopType === 'origin') {
            stopToVerify = origin;
            setStopState = setOrigin;
            stopToVerify.status = 'loading';
            setOrigin({...stopToVerify});
        } else if (stopType === 'hub') {
            stopToVerify = hub;
            setStopState = setHub;
            stopToVerify.status = 'loading';
            setHub({...stopToVerify});
        } else if ((stopType === 'longHaul' || stopType === 'lastMile') && index !== undefined) {
             const stops = stopType === 'longHaul' ? longHaulStops : lastMileStops;
             const setStops = stopType === 'longHaul' ? setLongHaulStops : setLastMileStops;
             const newStops = [...stops];
             stopToVerify = newStops[index];
             stopToVerify.status = 'loading';
             setStops(newStops);
             setStopState = (updater: any) => {
                const updatedStop = typeof updater === 'function' ? updater(newStops[index]) : updater;
                newStops[index] = updatedStop;
                setStops([...newStops]);
             }
        }

        if (stopToVerify && setStopState) {
            const coords = await geocodeAddress(stopToVerify.name);
            setStopState((prev: EditableStop) => ({
                ...prev,
                coords,
                status: coords ? 'verified' : 'error'
            }));
        }
    };
    
    const handleAddressChange = (value: string, stopType: 'origin' | 'hub' | 'longHaul' | 'lastMile', index?: number) => {
        const resetState = { coords: null, status: 'idle' as VerificationStatus };
        if (stopType === 'origin') {
            setOrigin(prev => ({ ...prev, name: value, ...resetState }));
        } else if (stopType === 'hub') {
            setHub(prev => ({ ...prev, name: value, ...resetState }));
        } else if ((stopType === 'longHaul' || stopType === 'lastMile') && index !== undefined) {
            const stops = stopType === 'longHaul' ? longHaulStops : lastMileStops;
            const setStops = stopType === 'longHaul' ? setLongHaulStops : setLastMileStops;
            const newStops = [...stops];
            newStops[index] = { ...newStops[index], name: value, ...resetState };
            setStops(newStops);
        }
    };

    const handleContentsChange = (value: string, index: number) => {
        const newStops = [...lastMileStops];
        newStops[index].contents = value;
        setLastMileStops(newStops);
    };

    const handleAddStop = (stopType: 'longHaul' | 'lastMile') => {
        const id = `stop-${Date.now()}-${Math.random()}`;
        if (stopType === 'lastMile') {
            setLastMileStops([...lastMileStops, {id, name: '', coords: null, status: 'idle', contents: ''}]);
        } else {
            setLongHaulStops([...longHaulStops, {id, name: '', coords: null, status: 'idle'}]);
        }
    };

    const handleRemoveStop = (index: number, stopType: 'longHaul' | 'lastMile') => {
        const stops = stopType === 'longHaul' ? longHaulStops : lastMileStops;
        const setStops = stopType === 'longHaul' ? setLongHaulStops : setLastMileStops;
        setStops(stops.filter((_, i) => i !== index));
    };

    const isCreatable = useMemo(() => {
        const hubVerified = hub.status === 'verified';
        const lastMileVerified = lastMileStops.length > 0 && lastMileStops.every(s => s.status === 'verified' && s.contents && s.contents.trim() !== '');

        if (isLastMileOnly) {
            return hubVerified && lastMileVerified;
        }

        return origin.status === 'verified' && hubVerified && 
               longHaulStops.every(s => s.status === 'verified') &&
               lastMileVerified;
    }, [origin, hub, longHaulStops, lastMileStops, isLastMileOnly]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!isCreatable) {
            alert("Please verify all addresses and fill in contents for all last-mile stops before creating the shipment.");
            return;
        }
        
        const finalOrigin = isLastMileOnly
            ? { id: hub.id, name: hub.name, location: hub.coords!, status: 'Completed' as const }
            : { id: origin.id, name: origin.name, location: origin.coords!, status: 'Completed' as const };

        const finalLongHaulStops = isLastMileOnly ? [] : longHaulStops.filter(s => s.name.trim() !== '').map((s, i) => ({
            id: `lh-${i}-${s.name.replace(/[^a-zA-Z0-9]/g, '').slice(0,4)}`,
            name: s.name,
            location: s.coords!,
            status: 'Pending' as const
        }));
        
        const finalLastMileStops: Stop[] = [];
        const finalShipmentItems: ShipmentItem[] = [];

        lastMileStops.filter(s => s.name.trim() !== '').forEach((s, i) => {
            const stopId = `lm-${i}-${s.name.replace(/[^a-zA-Z0-9]/g, '').slice(0,4)}`;
            finalLastMileStops.push({
                id: stopId,
                name: s.name,
                location: s.coords!,
                status: 'Pending'
            });

            if (s.contents && s.contents.trim() !== '') {
                finalShipmentItems.push({
                    id: `item-${i}-${s.name.replace(/[^a-zA-Z0-9]/g, '').slice(0,4)}`,
                    contents: s.contents,
                    destinationStopId: stopId
                });
            }
        });

        const hubIndex = 1 + finalLongHaulStops.length;

        const newShipment: Shipment = {
            trackingNumber: `SHIP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            shipmentItems: finalShipmentItems,
            origin: finalOrigin,
            longHaulStops: finalLongHaulStops,
            hub: { id: hub.id, name: hub.name, location: hub.coords!, status: 'Pending' },
            lastMileStops: finalLastMileStops,
            status: isLastMileOnly ? ShipmentStatus.AT_HUB : ShipmentStatus.PENDING,
            currentLegIndex: isLastMileOnly ? hubIndex : 0,
        };

        onShipmentCreated(newShipment);
    };

    
    const renderAddressInput = (
        stop: EditableStop,
        handler: (value: string) => void,
        verifier: () => void,
        label: string,
        placeholder: string,
    ) => (
        <div>
            <label className="block text-sm font-medium text-gray-700">{label}</label>
            <div className="mt-1 flex items-center space-x-2">
                <input type="text" value={stop.name} onChange={e => handler(e.target.value)} placeholder={placeholder} className="flex-grow px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-gray-900 placeholder-gray-500"/>
                <button type="button" onClick={verifier} disabled={!stop.name || stop.status === 'loading'} className="px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    Verify
                </button>
                <div className="w-6 h-6">
                    {stop.status === 'loading' && <Icon name="spinner" className="h-5 w-5 text-gray-400" />}
                    {stop.status === 'verified' && <Icon name="check-circle" className="h-6 w-6 text-green-500" />}
                    {stop.status === 'error' && <Icon name="x-circle" className="h-6 w-6 text-red-500" />}
                </div>
            </div>
             {stop.status === 'error' && <p className="text-xs text-red-500 mt-1">Address not found. Please try again.</p>}
        </div>
    );
    
    const renderStopList = (stopType: 'longHaul' | 'lastMile') => {
      const stops = stopType === 'longHaul' ? longHaulStops : lastMileStops;
      const title = stopType === 'longHaul' ? 'Long-Haul Stops (optional)' : 'Last-Mile Delivery Stops';
      const placeholder = stopType === 'longHaul' ? 'e.g., Rest Stop, Houston, TX' : 'e.g., Super 8, Port Arthur, TX';
      
      return (
        <div>
            <h3 className="text-lg font-medium text-gray-800 mb-2">{title}</h3>
            <div className="space-y-4">
                {stops.map((stop, index) => (
                    <div key={stop.id} className="flex items-start space-x-2">
                        <div className="flex-grow space-y-2 p-3 border rounded-md bg-gray-50">
                            {renderAddressInput(stop, (v) => handleAddressChange(v, stopType, index), () => handleVerify(stopType, index), `Stop ${index + 1} Address`, placeholder)}
                             {stopType === 'lastMile' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700">Shipment Contents for this Stop</label>
                                    <input
                                      type="text"
                                      value={stop.contents}
                                      onChange={(e) => handleContentsChange(e.target.value, index)}
                                      placeholder="e.g., 10 Mattresses, 5 boxes"
                                      className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                                      required
                                    />
                                </div>
                             )}
                        </div>
                        <button type="button" onClick={() => handleRemoveStop(index, stopType)} className="p-2 text-red-500 hover:bg-red-100 rounded-full mt-7">
                            <Icon name="trash" className="h-5 w-5" />
                        </button>
                    </div>
                ))}
            </div>
             <button type="button" onClick={() => handleAddStop(stopType)} className="mt-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" /></svg>
                Add Stop
            </button>
        </div>
      );
    }

    return (
         <div className="h-full bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white rounded-xl shadow-2xl p-8 overflow-y-auto max-h-full">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-3xl font-bold text-gray-800">Create New Shipment</h1>
                    <button onClick={onBack} className="text-sm text-gray-500 hover:text-indigo-600">
                        &larr; Back to Home
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="space-y-6">
                    {!isLastMileOnly && (
                        <>
                            {renderAddressInput(origin, (v) => handleAddressChange(v, 'origin'), () => handleVerify('origin'), 'Origin Point', 'e.g., Manufacturer, Austin, TX')}
                            {renderStopList('longHaul')}
                        </>
                    )}

                    {renderAddressInput(hub, (v) => handleAddressChange(v, 'hub'), () => handleVerify('hub'), 'Distribution Hub', 'e.g., Warehouse, Beaumont, TX')}

                    <div className="flex items-center">
                        <input
                            id="last-mile-only"
                            type="checkbox"
                            checked={isLastMileOnly}
                            onChange={(e) => setIsLastMileOnly(e.target.checked)}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                        />
                        <label htmlFor="last-mile-only" className="ml-2 block text-sm text-gray-900">
                            Create a Last-Mile only shipment (starts from Distribution Hub)
                        </label>
                    </div>

                    {renderStopList('lastMile')}

                    <button type="submit" disabled={!isCreatable} className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-transform transform hover:scale-105 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:transform-none">
                        Create Shipment & Generate Tracking IDs
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ShipmentCreator;