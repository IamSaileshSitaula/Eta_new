import React, { useState, useCallback } from 'react';
import HomeView from './components/HomeView';
import LoginView from './components/LoginView';
import TrackingView from './components/TrackingView';
import ManagerDashboard from './components/ManagerDashboard';
import ShipmentCreator from './components/ShipmentCreator';
import PostCreationInfo from './components/PostCreationInfo';
import { UserRole, Shipment, Stop } from './types';
import { INITIAL_SHIPMENT, TRACKING_NUMBERS as DEMO_TRACKING_NUMBERS } from './constants';
import Icon from './components/Icon';

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

  const [shipments, setShipments] = useState<Record<string, Shipment>>({
    'SHIP001': INITIAL_SHIPMENT
  });
  const [trackingNumberMap, setTrackingNumberMap] = useState<Record<string, TrackingInfo>>(DEMO_TRACKING_NUMBERS);
  const [generatedTrackingNumbers, setGeneratedTrackingNumbers] = useState<GeneratedTrackingNumber[]>([]);

  const handleTrack = useCallback((trackingNumber: string) => {
    const sessionData = trackingNumberMap[trackingNumber];
    if (sessionData) {
      const shipmentData = shipments[sessionData.shipmentId];
      if (shipmentData) {
        setSession({
          ...sessionData,
          trackingNumber,
          shipment: shipmentData,
        });
        setView('tracking');
        setError(null);
        return;
      }
    }
    setError('Invalid tracking number. Please try again.');
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
          return <ManagerDashboard trackingNumber={session.trackingNumber} shipment={session.shipment} />;
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
      <main className={`h-full w-full ${view === 'tracking' ? 'pt-16' : ''}`}>
        {renderContent()}
      </main>
    </div>
  );
};

export default App;
