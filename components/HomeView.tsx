import React from 'react';
import Icon from './Icon';

interface HomeViewProps {
    onCreate: () => void;
    onTrack: () => void;
}

const HomeView: React.FC<HomeViewProps> = ({ onCreate, onTrack }) => {
    return (
        <div className="h-full bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="text-center mb-12">
                <Icon name="truck" className="h-20 w-20 text-indigo-600 mx-auto" />
                <h1 className="text-4xl font-bold text-gray-800 mt-4">Logistics B2B Tracker</h1>
                <p className="text-gray-500 mt-2">Manage and track your B2B deliveries with confidence.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
                <button
                    onClick={onCreate}
                    className="group bg-white p-8 rounded-xl shadow-2xl hover:shadow-indigo-200 transition-shadow text-left"
                >
                    <h2 className="text-2xl font-bold text-gray-800 group-hover:text-indigo-600 transition-colors">Create New Shipment</h2>
                    <p className="text-gray-500 mt-2">Set up a new delivery, define stops, and generate tracking numbers for all parties.</p>
                </button>
                <button
                    onClick={onTrack}
                    className="group bg-white p-8 rounded-xl shadow-2xl hover:shadow-indigo-200 transition-shadow text-left"
                >
                    <h2 className="text-2xl font-bold text-gray-800 group-hover:text-indigo-600 transition-colors">Track Existing Shipment</h2>
                    <p className="text-gray-500 mt-2">Enter a tracking number to view the real-time status and location of a shipment.</p>
                </button>
            </div>
        </div>
    );
};

export default HomeView;
