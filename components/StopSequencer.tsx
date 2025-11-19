/**
 * Stop Sequencer Component
 * Drag-and-drop interface for reordering last-mile stops with ML optimization suggestions
 */

import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Stop } from '../types';
import Icon from './Icon';

interface StopSequencerProps {
  stops: Stop[];
  onSequenceChange: (newSequence: string[]) => void;
  onRequestOptimization: () => void;
  optimizationResult: {
    optimizedSequence: string[];
    timeSavings: number;
    confidence: number;
  } | null;
  onAcceptOptimization: () => void;
}

const StopSequencer: React.FC<StopSequencerProps> = ({
  stops,
  onSequenceChange,
  onRequestOptimization,
  optimizationResult,
  onAcceptOptimization
}) => {
  const [currentSequence, setCurrentSequence] = useState(stops.map(s => s.id));
  const [showOptimization, setShowOptimization] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    setCurrentSequence(stops.map(s => s.id));
  }, [stops]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) return;
    
    const oldIndex = currentSequence.indexOf(active.id as string);
    const newIndex = currentSequence.indexOf(over.id as string);
    
    const newSequence = arrayMove(currentSequence, oldIndex, newIndex);
    setCurrentSequence(newSequence);
    onSequenceChange(newSequence);
  };

  const handleRequestOptimization = async () => {
    setIsOptimizing(true);
    await onRequestOptimization();
    setIsOptimizing(false);
    setShowOptimization(true);
  };

  const handleAcceptOptimization = () => {
    if (optimizationResult) {
      setCurrentSequence(optimizationResult.optimizedSequence);
      // onSequenceChange is handled by the parent's onAcceptOptimization -> acceptOptimization flow
      // which triggers the hook's onSequenceChange callback.
      // Calling it here would cause a double update.
      // onSequenceChange(optimizationResult.optimizedSequence); 
      onAcceptOptimization();
      setShowOptimization(false);
    }
  };

  const hasOptimization = optimizationResult && optimizationResult.timeSavings > 3;

  return (
    <div className="stop-sequencer bg-white rounded-lg shadow-md p-4">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="font-bold text-lg text-gray-800">Last-Mile Stop Sequence</h3>
          <p className="text-xs text-gray-500 mt-1">
            Drag stops to reorder or use AI optimization
          </p>
        </div>
        <button
          onClick={handleRequestOptimization}
          disabled={isOptimizing || stops.length < 2}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
        >
          {isOptimizing ? (
            <>
              <Icon name="spinner" className="h-4 w-4 animate-spin" />
              <span>Optimizing...</span>
            </>
          ) : (
            <>
              <Icon name="zap" className="h-4 w-4" />
              <span>AI Optimize</span>
            </>
          )}
        </button>
      </div>

      {/* ML Optimization Suggestion */}
      {showOptimization && hasOptimization && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg p-4 mb-4 shadow-lg">
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center space-x-2">
              <div className="bg-green-600 p-2 rounded-full">
                <Icon name="zap" className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-green-900 text-lg">AI Optimization Available</p>
                <p className="text-sm text-green-700">
                  Save <strong>{optimizationResult.timeSavings.toFixed(0)} minutes</strong> with optimized sequence
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowOptimization(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <Icon name="x-circle" className="h-5 w-5" />
            </button>
          </div>

          {/* Confidence Badge */}
          <div className="mb-3">
            <div className="flex items-center space-x-2 text-xs">
              <Icon name="shield-check" className="h-4 w-4 text-green-600" />
              <span className="text-gray-700">Confidence:</span>
              <div className="bg-white rounded-full h-2 w-32 overflow-hidden">
                <div
                  className="bg-green-500 h-full"
                  style={{ width: `${(optimizationResult.confidence || 0.5) * 100}%` }}
                />
              </div>
              <span className="font-bold text-green-800">
                {((optimizationResult.confidence || 0.5) * 100).toFixed(0)}%
              </span>
            </div>
          </div>

          {/* Side-by-side comparison */}
          <div className="grid grid-cols-2 gap-4 text-sm mb-3">
            <div className="bg-white rounded-lg p-3 border border-gray-200">
              <p className="font-bold mb-2 text-gray-600 flex items-center">
                <Icon name="list" className="h-4 w-4 mr-1" />
                Current Order
              </p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700">
                {currentSequence.slice(0, 5).map(id => {
                  const stop = stops.find(s => s.id === id);
                  return (
                    <li key={id} className="text-xs truncate">
                      {stop?.name || 'Unknown'}
                    </li>
                  );
                })}
                {currentSequence.length > 5 && (
                  <li className="text-xs text-gray-400">
                    +{currentSequence.length - 5} more
                  </li>
                )}
              </ol>
            </div>

            <div className="bg-green-50 rounded-lg p-3 border-2 border-green-400">
              <p className="font-bold mb-2 text-green-700 flex items-center">
                <Icon name="zap" className="h-4 w-4 mr-1" />
                Optimized Order
              </p>
              <ol className="list-decimal list-inside space-y-1 text-green-800">
                {optimizationResult.optimizedSequence.slice(0, 5).map((id, idx) => {
                  const stop = stops.find(s => s.id === id);
                  const isChanged = currentSequence[idx] !== id;
                  return (
                    <li
                      key={id}
                      className={`text-xs truncate ${isChanged ? 'font-bold bg-green-100 px-1 rounded' : ''}`}
                    >
                      {stop?.name || 'Unknown'}
                      {isChanged && <span className="ml-1 text-green-600">↑</span>}
                    </li>
                  );
                })}
                {optimizationResult.optimizedSequence.length > 5 && (
                  <li className="text-xs text-green-600">
                    +{optimizationResult.optimizedSequence.length - 5} more
                  </li>
                )}
              </ol>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleAcceptOptimization}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition flex items-center justify-center space-x-2"
            >
              <Icon name="check-circle" className="h-5 w-5" />
              <span>Apply Optimization</span>
            </button>
            <button
              onClick={() => setShowOptimization(false)}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold py-2 px-4 rounded-lg transition"
            >
              Keep Current
            </button>
          </div>
        </div>
      )}

      {/* Draggable Stop List */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={currentSequence} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {currentSequence.map((stopId, index) => {
              const stop = stops.find(s => s.id === stopId);
              if (!stop) return null;
              
              const isOptimized = optimizationResult?.optimizedSequence[index] === stopId;
              const isChanged = optimizationResult && currentSequence[index] !== optimizationResult.optimizedSequence[index];
              
              return (
                <SortableStopItem
                  key={stopId}
                  stop={stop}
                  index={index}
                  isOptimized={isOptimized}
                  isChanged={isChanged || false}
                  totalStops={currentSequence.length}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {stops.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <Icon name="inbox" className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No last-mile stops to sequence</p>
        </div>
      )}

      {stops.length === 1 && (
        <div className="text-center py-4 text-sm text-gray-500">
          <Icon name="info" className="h-5 w-5 mx-auto mb-1" />
          <p>Need at least 2 stops to optimize sequence</p>
        </div>
      )}
    </div>
  );
};

interface SortableStopItemProps {
  stop: Stop;
  index: number;
  isOptimized: boolean;
  isChanged: boolean;
  totalStops: number;
}

const SortableStopItem: React.FC<SortableStopItemProps> = ({
  stop,
  index,
  isOptimized,
  isChanged,
  totalStops
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: stop.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`stop-item flex items-center p-3 rounded-lg cursor-move transition-all ${
        isDragging 
          ? 'shadow-xl bg-indigo-50 border-2 border-indigo-400' 
          : isOptimized
          ? 'bg-green-50 border-2 border-green-400 shadow-md'
          : isChanged
          ? 'bg-yellow-50 border-2 border-yellow-300'
          : 'bg-white border border-gray-300 hover:shadow-md'
      }`}
    >
      <div className="flex items-center space-x-3 flex-1">
        <div className="flex flex-col items-center">
          <Icon name="grip-vertical" className="h-5 w-5 text-gray-400" />
          <span className="text-xs font-bold text-gray-500 mt-1">{index + 1}</span>
        </div>

        <div className="flex-1">
          <p className="font-medium text-gray-900">{stop.name}</p>
          <div className="flex items-center space-x-3 mt-1">
            <span className="text-xs text-gray-500 flex items-center">
              <Icon name="clock" className="h-3 w-3 mr-1" />
              {stop.unloadingTimeMinutes || 0} min unload
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              stop.status === 'Completed' 
                ? 'bg-green-100 text-green-700'
                : stop.status === 'In Progress'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600'
            }`}>
              {stop.status}
            </span>
          </div>
        </div>

        {isOptimized && (
          <div className="flex items-center space-x-1 text-green-600">
            <Icon name="check-circle" className="h-5 w-5" />
            <span className="text-xs font-bold">Optimal</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default StopSequencer;
