import React from 'react';

interface GeneratedTrackingNumber {
    role: string;
    id: string;
}

interface PostCreationInfoProps {
    trackingNumbers: GeneratedTrackingNumber[];
    onTrackAsManager: (managerId: string) => void;
    onGoHome: () => void;
}

const PostCreationInfo: React.FC<PostCreationInfoProps> = ({ trackingNumbers, onTrackAsManager, onGoHome }) => {
    const managerId = trackingNumbers.find(tn => tn.role === 'Manager')?.id;

    return (
        <div className="h-full bg-gray-100 flex flex-col items-center justify-center p-4">
            <div className="max-w-2xl w-full bg-white rounded-xl shadow-2xl p-8 text-center">
                <h1 className="text-3xl font-bold text-gray-800">Shipment Created!</h1>
                <p className="text-gray-500 mt-2 mb-6">Use the following tracking numbers to monitor the shipment.</p>
                
                <div className="bg-gray-50 rounded-lg p-4 space-y-3 text-left">
                    {trackingNumbers.map(({ role, id }) => (
                        <div key={id} className="flex justify-between items-center">
                            <span className="font-medium text-gray-700">{role}:</span>
                            <code className="bg-gray-200 text-gray-800 font-mono px-3 py-1 rounded">{id}</code>
                        </div>
                    ))}
                </div>

                <div className="mt-8 flex flex-col md:flex-row gap-4">
                    {managerId && (
                         <button onClick={() => onTrackAsManager(managerId)} className="w-full bg-indigo-600 text-white font-bold py-3 px-4 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition">
                            Track as Manager
                        </button>
                    )}
                     <button onClick={onGoHome} className="w-full bg-gray-200 text-gray-700 font-bold py-3 px-4 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition">
                        Back to Home
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PostCreationInfo;
