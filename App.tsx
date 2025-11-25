import React, { useState, useCallback, useEffect } from 'react';
import HomeView from './components/HomeView';
import LoginView from './components/LoginView';
import TrackingView from './components/TrackingView';
import ManagerDashboard from './components/ManagerDashboard';
import ShipmentCreator from './components/ShipmentCreator';
import PostCreationInfo from './components/PostCreationInfo';
import { UserRole, Shipment, Stop, ShipmentStatus } from './types';
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
  createdAt?: string; // ISO timestamp
  accessCount?: number; // Track usage for analytics
}

interface UserSession extends TrackingInfo {
  trackingNumber: string;
  shipment: Shipment;
}

interface GeneratedTrackingNumber {
  role: string;
  id: string;
}

// Tracking number validation utilities
const TRACKING_NUMBER_PATTERNS = {
  MANAGER: /^MGR-[A-Z0-9]{6}$/,
  SUPPLIER: /^SUP-[A-Z0-9]{6}$/,
  RECIPIENT: /^[A-Z]{2,4}-[A-Z0-9]{6}$/,
  DEMO_SUPPLIER: /^SUPPLIER\d*$/,
  DEMO_RECIPIENT: /^RECIPIENT\d*$/,
  DEMO_MANAGER: /^MANAGER\d*$/,
};

const isValidTrackingNumberFormat = (trackingNumber: string): boolean => {
  return Object.values(TRACKING_NUMBER_PATTERNS).some(pattern => pattern.test(trackingNumber));
};

const generateSecureTrackingId = (prefix: string): string => {
  // Use characters that are easy to read/type (excluded confusing chars like I, O, 0, 1, L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let randomPart = '';
  for (let i = 0; i < 6; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}-${randomPart}`;
};

const DEMO_SHIPMENT_ID = 'SHIP001';

const cloneShipment = (shipment: Shipment): Shipment => JSON.parse(JSON.stringify(shipment));

const resetStop = (stop: Stop): Stop => ({ ...stop, status: 'Pending' });

const createFreshDemoShipment = (): Shipment => {
  const base = cloneShipment(INITIAL_SHIPMENT);
  return {
    ...base,
    origin: resetStop(base.origin),
    hub: resetStop(base.hub),
    longHaulStops: (base.longHaulStops || []).map(resetStop),
    lastMileStops: (base.lastMileStops || []).map(resetStop),
    currentLegIndex: 0,
    status: ShipmentStatus.PENDING,
    currentEta: undefined,
    currentLocation: base.origin.location,
  };
};

const migrateDemoShipments = (data: Record<string, Shipment>): Record<string, Shipment> => {
  const copy: Record<string, Shipment> = { ...data };
  const demo = copy[DEMO_SHIPMENT_ID];

  const hasAustinOrigin = demo?.origin?.name?.toLowerCase().includes('austin') ?? false;
  const originMismatch = demo?.origin?.location
    ? Math.abs(demo.origin.location[0] - INITIAL_SHIPMENT.origin.location[0]) > 0.01 ||
      Math.abs(demo.origin.location[1] - INITIAL_SHIPMENT.origin.location[1]) > 0.01
    : true;
  const hasLongHaul = (demo?.longHaulStops?.length ?? 0) > 0;
  const insufficientLastMile = (demo?.lastMileStops?.length ?? 0) < 10;

  const needsMigration = !demo || hasAustinOrigin || hasLongHaul || insufficientLastMile || originMismatch;

  if (needsMigration) {
    copy[DEMO_SHIPMENT_ID] = createFreshDemoShipment();
    console.log('🧭 Migrated demo shipment SHIP001 to Beaumont-only last-mile scenario');
  } else if (copy[DEMO_SHIPMENT_ID]) {
    // Always start the demo in a fresh state for repeatable simulations
    copy[DEMO_SHIPMENT_ID] = createFreshDemoShipment();
    console.log('🔄 Reset demo shipment progress for fresh session');
  }

  return copy;
};

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
        return migrateDemoShipments(parsed);
      }
    } catch (error) {
      console.error('Failed to load shipments from localStorage:', error);
    }
    // Return demo data if nothing in localStorage
    return migrateDemoShipments({ [DEMO_SHIPMENT_ID]: INITIAL_SHIPMENT });
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
    // Normalize and validate input
    const trackingNumber = trackingNumberInput.trim().toUpperCase().replace(/\s+/g, '');
    console.log(`🔍 Attempting to track: "${trackingNumber}"`);
    
    // Basic validation
    if (!trackingNumber) {
      setError('Please enter a tracking number.');
      setSession(null);
      return;
    }

    if (trackingNumber.length < 4) {
      setError('Tracking number is too short. Please check and try again.');
      setSession(null);
      return;
    }

    // Check format validity (warn but don't block - allows legacy/demo numbers)
    if (!isValidTrackingNumberFormat(trackingNumber)) {
      console.warn('⚠️ Tracking number format is unusual:', trackingNumber);
    }

    console.log('📋 Available tracking numbers:', Object.keys(trackingNumberMap));

    const sessionData = trackingNumberMap[trackingNumber];
    if (sessionData) {
      console.log('✅ Found session data:', sessionData);
      
      // Update access count for analytics
      setTrackingNumberMap(prev => ({
        ...prev,
        [trackingNumber]: {
          ...prev[trackingNumber],
          accessCount: (prev[trackingNumber]?.accessCount || 0) + 1
        }
      }));

      let shipmentData = shipments[sessionData.shipmentId];
      if (sessionData.shipmentId === DEMO_SHIPMENT_ID) {
        shipmentData = createFreshDemoShipment();
        setShipments(prev => ({ ...prev, [DEMO_SHIPMENT_ID]: shipmentData! }));
        console.log('♻️ Resetting SUPPLIER123 demo shipment for new simulation');
      }
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
    const createdAt = new Date().toISOString();

    const newTrackingMap: Record<string, TrackingInfo> = {};
    const newGeneratedNumbers: GeneratedTrackingNumber[] = [];

    // Use the secure ID generator for all tracking numbers
    const managerId = generateSecureTrackingId('MGR');
    newTrackingMap[managerId] = { 
      role: UserRole.MANAGER, 
      shipmentId: newShipmentId,
      createdAt,
      accessCount: 0
    };
    newGeneratedNumbers.push({ role: 'Manager', id: managerId });

    const supplierId = generateSecureTrackingId('SUP');
    newTrackingMap[supplierId] = { 
      role: UserRole.SUPPLIER, 
      shipmentId: newShipmentId,
      createdAt,
      accessCount: 0
    };
    newGeneratedNumbers.push({ role: 'Supplier', id: supplierId });

    // Generate recipient tracking numbers for each last-mile stop
    newShipment.lastMileStops.forEach(stop => {
      // Create a clean prefix from stop name (2-4 chars)
      const cleanName = stop.name.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const prefix = cleanName.length >= 2 ? cleanName.substring(0, Math.min(4, cleanName.length)) : 'RCP';
      const recipientId = generateSecureTrackingId(prefix);
      
      newTrackingMap[recipientId] = { 
        role: UserRole.RECIPIENT, 
        shipmentId: newShipmentId, 
        recipientStopId: stop.id,
        createdAt,
        accessCount: 0
      };
      newGeneratedNumbers.push({ role: `Recipient: ${stop.name}`, id: recipientId });
    });
    
    console.log(`📝 Created ${Object.keys(newTrackingMap).length} tracking numbers for shipment ${newShipmentId}`);
    
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
        
        const currentShipment = shipments[session.shipmentId] || session.shipment;
        
        if (session.role === UserRole.MANAGER) {
          return (
            <ManagerDashboard 
              trackingNumber={session.trackingNumber} 
              shipment={currentShipment}
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
            shipment={currentShipment}
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
