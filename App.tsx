import React, { useState, useCallback, useEffect } from 'react';
import HomeView from './components/HomeView';
import LoginView from './components/LoginView';
import TrackingView from './components/TrackingView';
import ManagerDashboard from './components/ManagerDashboard';
import ShipmentCreator from './components/ShipmentCreator';
import PostCreationInfo from './components/PostCreationInfo';
import { UserRole, Shipment, Stop } from './types';
import { INITIAL_SHIPMENT, TRACKING_NUMBERS as DEMO_TRACKING_NUMBERS } from './constants';
import Icon from './components/Icon';

// LocalStorage keys for persistence
const STORAGE_KEYS = {
  SHIPMENTS: 'logistics_shipments',
  TRACKING_NUMBERS: 'logistics_tracking_numbers',
};

type View = 'home' | 'create' | 'login' | 'tracking' | 'post_creation';

interface TrackingInfo {
  role: UserRole;
  shipmentId: string;
  recipientStopId?: string;
}

interface UserSession extends TrackingInfo {
  trackingNumber: string;
  shipment: Shipment;
}

interface GeneratedTrackingNumber {
  role: string;
  id: string;
}

const App: React.FC = () => {
  const [view, setView] = useState<View>('home');
  const [session, setSession] = useState<UserSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load from localStorage or use demo data
  const [shipments, setShipments] = useState<Record<string, Shipment>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SHIPMENTS);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('📦 Loaded shipments from localStorage:', Object.keys(parsed));
        return parsed;
      }
    } catch (error) {
      console.error('Failed to load shipments from localStorage:', error);
    }
    // Return demo data if nothing in localStorage
    return { 'SHIP001': INITIAL_SHIPMENT };
  });

  const [trackingNumberMap, setTrackingNumberMap] = useState<Record<string, TrackingInfo>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.TRACKING_NUMBERS);
      if (stored) {
        const parsed = JSON.parse(stored);
        console.log('🔢 Loaded tracking numbers from localStorage:', Object.keys(parsed));
        return parsed;
      }
    } catch (error) {
      console.error('Failed to load tracking numbers from localStorage:', error);
    }
    // Return demo data if nothing in localStorage
    return DEMO_TRACKING_NUMBERS;
  });

  const [generatedTrackingNumbers, setGeneratedTrackingNumbers] = useState<GeneratedTrackingNumber[]>([]);

  // Persist shipments to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.SHIPMENTS, JSON.stringify(shipments));
      console.log('💾 Saved shipments to localStorage:', Object.keys(shipments));
    } catch (error) {
      console.error('Failed to save shipments to localStorage:', error);
    }
  }, [shipments]);

  // Persist tracking numbers to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TRACKING_NUMBERS, JSON.stringify(trackingNumberMap));
      console.log('💾 Saved tracking numbers to localStorage:', Object.keys(trackingNumberMap));
    } catch (error) {
      console.error('Failed to save tracking numbers to localStorage:', error);
    }
  }, [trackingNumberMap]);

  const handleTrack = useCallback((trackingNumberInput: string) => {
    const trackingNumber = trackingNumberInput.trim().toUpperCase();
    console.log(`🔍 Attempting to track: "${trackingNumber}"`);
    console.log('📋 Available tracking numbers:', Object.keys(trackingNumberMap));

    const sessionData = trackingNumberMap[trackingNumber];
    if (sessionData) {
      console.log('✅ Found session data:', sessionData);
      const shipmentData = shipments[sessionData.shipmentId];
      if (shipmentData) {
        console.log('✅ Found shipment data:', shipmentData.trackingNumber);
        setSession({
          ...sessionData,
          trackingNumber,
          shipment: shipmentData,
        });
        setView('tracking');
        setError(null);
        return;
      } else {
        console.error('❌ Shipment data missing for ID:', sessionData.shipmentId);
        console.log('📦 Available shipments:', Object.keys(shipments));
      }
    } else {
      console.warn('❌ Tracking number not found in map');
    }
    setError(`Invalid tracking number "${trackingNumber}". Please try again.`);
    setSession(null);
  }, [trackingNumberMap, shipments]);

  const handleLogout = () => {
    setSession(null);
    setView('home');
  };

  const handleShipmentCreated = (newShipment: Shipment) => {
    const newShipmentId = newShipment.trackingNumber;

    const newTrackingMap: Record<string, TrackingInfo> = {};
    const newGeneratedNumbers: GeneratedTrackingNumber[] = [];

    const generateId = (prefix: string) => `${prefix}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    const managerId = generateId('MGR');
    newTrackingMap[managerId] = { role: UserRole.MANAGER, shipmentId: newShipmentId };
    newGeneratedNumbers.push({ role: 'Manager', id: managerId });

    const supplierId = generateId('SUP');
    newTrackingMap[supplierId] = { role: UserRole.SUPPLIER, shipmentId: newShipmentId };
    newGeneratedNumbers.push({ role: 'Supplier', id: supplierId });

    newShipment.lastMileStops.forEach(stop => {
      const prefix = stop.name.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const recipientId = generateId(prefix || 'RCPT');
      newTrackingMap[recipientId] = { role: UserRole.RECIPIENT, shipmentId: newShipmentId, recipientStopId: stop.id };
      newGeneratedNumbers.push({ role: `Recipient: ${stop.name}`, id: recipientId });
    });
    
    setShipments(prev => ({ ...prev, [newShipmentId]: newShipment }));
    setTrackingNumberMap(prev => ({ ...prev, ...newTrackingMap }));
    setGeneratedTrackingNumbers(newGeneratedNumbers);
    setView('post_creation');
  };

  const handleShipmentUpdate = (shipmentId: string, updatedShipment: Shipment) => {
    setShipments(prev => ({
      ...prev,
      [shipmentId]: updatedShipment
    }));
  };

  const renderContent = () => {
    switch(view) {
      case 'home':
        return <HomeView onCreate={() => setView('create')} onTrack={() => setView('login')} />;
      case 'create':
        return <ShipmentCreator onShipmentCreated={handleShipmentCreated} onBack={() => setView('home')} />;
      case 'login':
        return <LoginView onTrack={handleTrack} error={error} onBack={() => setView('home')} />;
      case 'post_creation':
        return <PostCreationInfo 
                  trackingNumbers={generatedTrackingNumbers}
                  onTrackAsManager={(id) => handleTrack(id)}
                  onGoHome={() => setView('home')}
               />;
      case 'tracking':
        if (!session) return <LoginView onTrack={handleTrack} error="Session expired." onBack={() => setView('home')} />;
        if (session.role === UserRole.MANAGER) {
          return (
            <ManagerDashboard 
              trackingNumber={session.trackingNumber} 
              shipment={session.shipment}
              allShipments={shipments}
              trackingNumberMap={trackingNumberMap}
              onShipmentUpdate={handleShipmentUpdate}
            />
          );
        }
        return (
          <TrackingView
            trackingNumber={session.trackingNumber}
            role={session.role}
            recipientStopId={session.recipientStopId}
            shipment={session.shipment}
          />
        );
      default:
        return <HomeView onCreate={() => setView('create')} onTrack={() => setView('login')} />;
    }
  };
  
  return (
    <div className="h-screen w-screen font-sans text-gray-900">
      {view === 'tracking' && session && (
        <header className="absolute top-0 left-0 w-full bg-black bg-opacity-30 text-white flex justify-between items-center p-3 z-10">
          <div className="flex items-center space-x-2">
              <Icon name="truck" className="h-8 w-8 text-indigo-400"/>
              <span className="font-bold text-lg">Logistics Tracker</span>
          </div>
          <button 
            onClick={handleLogout}
            className="bg-red-500 hover:bg-red-600 text-white text-sm font-bold py-2 px-4 rounded"
          >
            End Session
          </button>
        </header>
      )}
      <main className={`h-full w-full ${view === 'tracking' ? 'pt-16' : ''} bg-gray-50`}>
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
