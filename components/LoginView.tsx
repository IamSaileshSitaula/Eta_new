import React, { useState } from 'react';
import Icon from './Icon';

interface LoginViewProps {
    onTrack: (trackingNumber: string) => void;
    error: string | null;
    onBack: () => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onTrack, error, onBack }) => {
    const [trackingNumber, setTrackingNumber] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onTrack(trackingNumber.trim());
    };

    return (
        <div className="h-full bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full bg-white rounded-xl shadow-2xl p-8 space-y-6 relative">
                 <button onClick={onBack} className="absolute top-4 left-4 text-sm text-gray-500 hover:text-indigo-600">
                    &larr; Back
                </button>
                <div className="flex flex-col items-center space-y-2 pt-8">
                    <Icon name="truck" className="h-16 w-16 text-indigo-600" />
                    <h1 className="text-3xl font-bold text-gray-800">Logistics Tracking</h1>
                    <p className="text-gray-500">Enter your tracking number to see shipment status.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <input
                        type="text"
                        value={trackingNumber}
                        onChange={(e) => setTrackingNumber(e.target.value)}
                        placeholder="e.g., SUPPLIER123 or SUPER8-456"
                        className="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
                    />
                    {error && <p className="text-red-500 text-sm">{error}</p>}
                    <button
                        type="submit"
                        className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-transform transform hover:scale-105"
                    >
                        Track Shipment
                    </button>
                </form>
                <div className="text-xs text-gray-400 text-center">
                    <p>Demo Numbers: SUPPLIER123, SUPER8-456, MANAGER789</p>
                </div>
            </div>
        </div>
    );
};

export default LoginView;
