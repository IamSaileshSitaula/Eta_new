/**
 * Last-Mile Optimization Hook
 * Manages stop sequencing with ML optimization
 */

import { useState, useCallback } from 'react';
import { Stop } from '../types';
import { optimizeStopSequence, OptimizationResult, validateOptimizedSequence } from '../services/lastMileService';

export interface UseLastMileOptimizationOptions {
  stops: Stop[];
  vehiclePosition?: { lat: number; lng: number };
  onSequenceChange?: (newSequence: string[]) => void;
  onOptimizationAccepted?: (result: OptimizationResult) => void;
}

export interface UseLastMileOptimizationReturn {
  currentSequence: string[];
  optimizationResult: OptimizationResult | null;
  isOptimizing: boolean;
  error: string | null;
  requestOptimization: () => Promise<void>;
  acceptOptimization: () => void;
  rejectOptimization: () => void;
  manuallyReorderStops: (newSequence: string[]) => void;
}

/**
 * Hook for managing last-mile stop optimization
 */
export function useLastMileOptimization({
  stops,
  vehiclePosition,
  onSequenceChange,
  onOptimizationAccepted
}: UseLastMileOptimizationOptions): UseLastMileOptimizationReturn {
  const [currentSequence, setCurrentSequence] = useState<string[]>(
    stops.map(s => s.id)
  );
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Request ML optimization for current stop sequence
   */
  const requestOptimization = useCallback(async () => {
    if (stops.length <= 1) {
      setError('Need at least 2 stops to optimize');
      return;
    }

    setIsOptimizing(true);
    setError(null);

    try {
      const result = await optimizeStopSequence({
        stops,
        vehicleStartPosition: vehiclePosition,
        currentSequence
      });

      // Validate result
      const validation = validateOptimizedSequence(stops, result.optimizedSequence);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      setOptimizationResult(result);
      console.log('✅ Optimization complete:', {
        timeSavings: `${result.timeSavings.toFixed(1)} min`,
        distanceSavings: `${result.distanceSavings.toFixed(1)} mi`,
        confidence: `${(result.confidence * 100).toFixed(0)}%`
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Optimization failed';
      setError(errorMsg);
      console.error('❌ Optimization error:', err);
    } finally {
      setIsOptimizing(false);
    }
  }, [stops, vehiclePosition, currentSequence]);

  /**
   * Accept the ML optimization and apply new sequence
   */
  const acceptOptimization = useCallback(() => {
    if (!optimizationResult) return;

    const newSequence = optimizationResult.optimizedSequence;
    setCurrentSequence(newSequence);
    setOptimizationResult(null);

    // Notify parent component
    onSequenceChange?.(newSequence);
    onOptimizationAccepted?.(optimizationResult);

    console.log('✅ Optimization accepted:', newSequence);
  }, [optimizationResult, onSequenceChange, onOptimizationAccepted]);

  /**
   * Reject the ML optimization and keep current sequence
   */
  const rejectOptimization = useCallback(() => {
    setOptimizationResult(null);
    console.log('❌ Optimization rejected');
  }, []);

  /**
   * Manually reorder stops (from drag-and-drop)
   */
  const manuallyReorderStops = useCallback((newSequence: string[]) => {
    // Validate sequence
    const validation = validateOptimizedSequence(stops, newSequence);
    if (!validation.valid) {
      setError(validation.error || 'Invalid sequence');
      return;
    }

    setCurrentSequence(newSequence);
    setOptimizationResult(null); // Clear optimization result when manually changed
    setError(null);

    // Notify parent component
    onSequenceChange?.(newSequence);

    console.log('🔄 Manual reorder:', newSequence);
  }, [stops, onSequenceChange]);

  return {
    currentSequence,
    optimizationResult,
    isOptimizing,
    error,
    requestOptimization,
    acceptOptimization,
    rejectOptimization,
    manuallyReorderStops
  };
}

export default useLastMileOptimization;
