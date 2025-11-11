
import React from 'react';
import Icon from './Icon';

interface StatusCardProps {
    icon: string;
    title: string;
    value: React.ReactNode;
    colorClass: string;
    subtext?: string;
}

const StatusCard: React.FC<StatusCardProps> = ({ icon, title, value, colorClass, subtext }) => {
    return (
        <div className="bg-white p-4 rounded-lg shadow-md flex items-start space-x-4">
            <div className={`p-3 rounded-full ${colorClass} text-white`}>
                <Icon name={icon} className="h-6 w-6" />
            </div>
            <div>
                <p className="text-sm text-gray-500 font-medium">{title}</p>
                <p className="text-xl font-bold text-gray-800">{value}</p>
                {subtext && <p className="text-xs text-gray-400 mt-1">{subtext}</p>}
            </div>
        </div>
    );
};

export default StatusCard;
