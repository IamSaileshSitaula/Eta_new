# 🚛 Comprehensive Rerouting Engine Architecture

**Senior Systems Architect Analysis**  
**Date:** November 16, 2025  
**Project:** ETA Tracker / Logistics Routing Platform

---

## 📋 Executive Summary

### Current System Status

#### ✅ **What EXISTS:**
1. **ML Models Trained (Both Complete)**
   - ✅ ETA Prediction Model: 92.8% accuracy, 2.16 min error (transformer-based, 807K parameters)
   - ✅ Route Optimization Model: 87.5% accuracy (GNN-based, 117K parameters)

2. **ML Backend Operational**
   - ✅ FastAPI server running on port 8000
   - ✅ `/api/eta/predict` endpoint with hybrid physics + ML
   - ✅ `/api/reroute` endpoint for last-mile optimization
   - ✅ Trained models saved: `eta_model_best.pth`, `reroute_model_best.pth`

3. **Basic Rerouting Infrastructure**
   - ✅ `RerouteSuggestion` type defined in `types.ts`
   - ✅ Hardcoded traffic-based suggestion in `useShipmentData.ts` (line 203-211)
   - ✅ UI component in `ManagerDashboard.tsx` (lines 125-131)
   - ✅ ML rerouting service stub: `services/mlReroutingService.ts`
   - ✅ Backend router: `ml-backend/app/routers/reroute.py` with heuristic + ML methods

#### ❌ **What's MISSING (Critical Gaps):**

1. **Long-Haul Multi-Route Support**
   - ❌ No multiple route generation (only single OSRM path)
   - ❌ No alternative route comparison engine
   - ❌ No route metadata (tolls, highways, traffic risk scores)
   - ❌ No visual route comparison UI (Google Maps style)

2. **Dynamic Rerouting During Transit**
   - ❌ No continuous route evaluation loop
   - ❌ No historical data integration for confidence scoring
   - ❌ No accept/reject mechanism for manager control
   - ❌ Rerouting is hardcoded (only triggers on heavy traffic once)

3. **Last-Mile Stop Sequencing**
   - ❌ No drag-and-drop UI for manual resequencing
   - ❌ No dynamic stop reordering suggestions
   - ❌ No comparative ETA display (original vs optimized)
   - ❌ Backend ML model not integrated (trained but unused)

4. **Propagation & State Management**
   - ❌ No tracking number update mechanism
   - ❌ No supplier/receiver notification system
   - ❌ No reroute history/audit trail
   - ❌ Tracking numbers stored in-memory (lost on restart)

---

## 1️⃣ SYSTEM DESIGN AUDIT

### 🔍 Features to KEEP (Well-Designed)

| Component | Reason | Status |
|-----------|--------|--------|
| **Hybrid ETA System** | Physics + ML fallback pattern excellent | ✅ Production-ready |
| **Real-time Data Integration** | TomTom Traffic + OpenWeather + Gemini AI | ✅ Working well |
| **Role-Based Views** | Manager/Supplier/Recipient separation clean | ✅ Keep as-is |
| **OSRM Routing** | Real road network integration | ✅ Solid foundation |
| **ML Model Training** | 92.8% ETA, 87.5% route accuracy | ✅ Models trained |
| **Road Segment Analysis** | `speedSimulationService.ts` is sophisticated | ✅ Keep |
| **Unloading Time Prediction** | Gemini AI integration works | ✅ Keep |

### 🔄 Features to MODIFY (Needs Enhancement)

| Component | Current Issue | Required Change |
|-----------|---------------|-----------------|
| **`useShipmentData` hook** | 700 lines, too many responsibilities | Split into: `useRouteSimulation`, `useRerouting`, `useETACalculation` |
| **Reroute suggestion** | Hardcoded single trigger (line 203) | Replace with continuous evaluation engine |
| **`Shipment` type** | No route history, no active route concept | Add `activeRouteId`, `routeHistory[]`, `availableRoutes[]` |
| **`ManagerDashboard`** | Passive display only | Add route selection UI, accept/reject controls |
| **Tracking number map** | In-memory only | Persist to database/localStorage |
| **`RerouteSuggestion`** | Too simple (4 fields) | Add route options array, comparison data |

### ❌ Features to REMOVE/DEPRECATE

| Component | Why Remove | Replacement |
|-----------|------------|-------------|
| **Hardcoded routes** | `constants.ts` ROUTE_AUSTIN_BEAUMONT | Generate dynamically via multi-route engine |
| **Single-path assumption** | `visiblePath` assumes one route | Multi-route state with active selection |
| **Static `rerouteSuggestion`** | Set once, never updates | Continuous evaluation system |
| **Mock reroute trigger** | Line 204: `if (trafficData.status === 'Heavy' && !rerouteSuggestion)` | ML-based trigger with confidence threshold |

---

## 2️⃣ REROUTING ENGINE REQUIREMENTS (Detailed Design)

### A. Long-Haul Multi-Route Engine

#### Backend Architecture

```typescript
// NEW: Multi-route generation service
interface RouteOption {
  id: string;                          // "route-1", "route-2", etc.
  path: Coordinates[];                  // OSRM geometry
  segments: RoadSegment[];              // Detailed road data
  metadata: {
    totalDistanceMiles: number;
    baseETAMinutes: number;             // Without traffic
    currentETAMinutes: number;          // With live conditions
    tollRoadMiles: number;              // Miles on toll roads
    highwayMiles: number;               // Interstate/highway %
    avgSpeedLimit: number;              // Average speed limit
    trafficRiskScore: number;           // 0-1 (ML-predicted congestion likelihood)
    weatherRiskScore: number;           // 0-1 (exposure to bad weather)
    routeType: 'fastest' | 'shortest' | 'balanced' | 'toll-free';
  };
  liveConditions: {
    currentTrafficLevel: 'Light' | 'Moderate' | 'Heavy';
    weatherCondition: string;
    estimatedDelay: number;             // Minutes vs baseETA
    confidence: ConfidenceLevel;
  };
}

interface MultiRouteResponse {
  routes: RouteOption[];                // 3-4 alternatives
  recommended: string;                  // route-id with best score
  comparisonMatrix: {
    fastestRoute: string;
    shortestRoute: string;
    cheapestRoute: string;               // No tolls
    safestRoute: string;                 // Lowest risk scores
  };
  generatedAt: Date;
  validUntil: Date;                     // Cache expiration (5 min)
}
```

#### Implementation Plan

**File:** `services/multiRouteService.ts` (NEW)

```typescript
export async function generateAlternativeRoutes(
  origin: Coordinates,
  destination: Coordinates,
  options: {
    includeHighways: boolean;
    includeTolls: boolean;
    maxAlternatives: number;
  }
): Promise<MultiRouteResponse> {
  // 1. Query OSRM with alternative=true (generates 2-3 variants)
  const osrmAlternatives = await fetchOSRMAlternativeRoutes(origin, destination);
  
  // 2. Generate additional routes using GraphHopper (toll-free, shortest)
  const graphHopperRoutes = await fetchGraphHopperRoutes(origin, destination, {
    avoid: options.includeTolls ? [] : ['toll'],
    algorithm: 'alternative_route'
  });
  
  // 3. Combine and deduplicate (max 4 routes)
  const allRoutes = [...osrmAlternatives, ...graphHopperRoutes];
  const uniqueRoutes = deduplicateRoutes(allRoutes, similarityThreshold = 0.7);
  
  // 4. Enrich each route with metadata
  const enrichedRoutes = await Promise.all(uniqueRoutes.map(async (route) => {
    return {
      ...route,
      metadata: await calculateRouteMetadata(route),
      liveConditions: await getLiveConditions(route.path)
    };
  }));
  
  // 5. ML-based ranking (use trained ETA model)
  const rankedRoutes = await rankRoutesWithML(enrichedRoutes);
  
  return {
    routes: rankedRoutes,
    recommended: rankedRoutes[0].id,
    comparisonMatrix: buildComparisonMatrix(rankedRoutes),
    generatedAt: new Date(),
    validUntil: new Date(Date.now() + 300000) // 5 min cache
  };
}
```

**File:** `ml-backend/app/routers/multi_route.py` (NEW)

```python
@router.post("/api/routes/alternatives")
async def generate_alternative_routes(request: MultiRouteRequest) -> MultiRouteResponse:
    """
    Generate 3-4 alternative routes with ML-enhanced scoring
    """
    # 1. OSRM alternatives
    osrm_routes = await fetch_osrm_alternatives(
        origin=request.origin,
        destination=request.destination,
        alternatives=3
    )
    
    # 2. GraphHopper variants (toll-free, shortest, fastest)
    graphhopper_routes = await fetch_graphhopper_routes(
        origin=request.origin,
        destination=request.destination,
        profiles=['fastest', 'shortest', 'toll_free']
    )
    
    # 3. Merge and deduplicate
    all_routes = osrm_routes + graphhopper_routes
    unique_routes = deduplicate_by_similarity(all_routes, threshold=0.7)
    
    # 4. ML enrichment using trained ETA model
    enriched_routes = []
    for route in unique_routes[:4]:  # Max 4 routes
        # Calculate features for ML model
        features = extract_route_features(route, request.current_conditions)
        
        # Predict ETA using trained model
        eta_prediction = eta_model.predict(features)
        
        # Calculate risk scores
        traffic_risk = predict_traffic_risk(route.segments, request.time_of_day)
        weather_risk = predict_weather_risk(route.geometry, request.forecast)
        
        enriched_routes.append({
            "id": f"route-{len(enriched_routes) + 1}",
            "path": route.geometry,
            "metadata": {
                "totalDistanceMiles": route.distance * 0.000621371,
                "baseETAMinutes": route.duration / 60,
                "currentETAMinutes": eta_prediction.eta_minutes,
                "tollRoadMiles": calculate_toll_miles(route.segments),
                "highwayMiles": calculate_highway_miles(route.segments),
                "avgSpeedLimit": calculate_avg_speed_limit(route.segments),
                "trafficRiskScore": traffic_risk,
                "weatherRiskScore": weather_risk,
                "routeType": classify_route_type(route)
            },
            "liveConditions": {
                "currentTrafficLevel": get_traffic_level(traffic_risk),
                "weatherCondition": request.current_conditions.weather,
                "estimatedDelay": eta_prediction.eta_minutes - (route.duration / 60),
                "confidence": eta_prediction.confidence
            }
        })
    
    # 5. Rank routes by composite score
    ranked_routes = rank_routes_ml(enriched_routes, preferences=request.preferences)
    
    return {
        "routes": ranked_routes,
        "recommended": ranked_routes[0]["id"],
        "comparisonMatrix": build_comparison_matrix(ranked_routes),
        "generatedAt": datetime.now().isoformat(),
        "validUntil": (datetime.now() + timedelta(minutes=5)).isoformat()
    }
```

#### Frontend UI (Manager Dashboard)

**File:** `components/RouteSelector.tsx` (NEW)

```typescript
interface RouteSelectorProps {
  routes: RouteOption[];
  activeRouteId: string;
  onSelectRoute: (routeId: string) => void;
  truckPosition: Coordinates;
}

const RouteSelector: React.FC<RouteSelectorProps> = ({
  routes, activeRouteId, onSelectRoute, truckPosition
}) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="route-selector">
      {/* Compact view: Show active route + toggle */}
      <div className="active-route-bar bg-indigo-600 text-white p-3 flex justify-between">
        <div>
          <span className="font-bold">Active Route:</span> {activeRoute.metadata.routeType}
          <span className="ml-2">ETA: {activeRoute.metadata.currentETAMinutes} min</span>
        </div>
        <button onClick={() => setExpanded(!expanded)}>
          {routes.length - 1} alternatives ▼
        </button>
      </div>
      
      {/* Expanded view: All routes comparison */}
      {expanded && (
        <div className="routes-grid grid grid-cols-2 gap-4 p-4">
          {routes.map((route) => (
            <RouteCard
              key={route.id}
              route={route}
              isActive={route.id === activeRouteId}
              onSelect={() => onSelectRoute(route.id)}
            />
          ))}
        </div>
      )}
      
      {/* Map overlay: Show all routes with different colors */}
      <RouteOverlay
        routes={routes}
        activeRouteId={activeRouteId}
        truckPosition={truckPosition}
      />
    </div>
  );
};

const RouteCard: React.FC<{route: RouteOption, isActive: boolean, onSelect: () => void}> = ({
  route, isActive, onSelect
}) => {
  return (
    <div 
      className={`route-card border-2 rounded-lg p-4 cursor-pointer transition ${
        isActive ? 'border-indigo-600 bg-indigo-50' : 'border-gray-300 hover:border-indigo-400'
      }`}
      onClick={onSelect}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="font-bold capitalize">{route.metadata.routeType}</span>
        {isActive && <Icon name="check-circle" className="text-green-500" />}
      </div>
      
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span>ETA:</span>
          <span className="font-bold">{route.metadata.currentETAMinutes} min</span>
        </div>
        <div className="flex justify-between">
          <span>Distance:</span>
          <span>{route.metadata.totalDistanceMiles.toFixed(1)} mi</span>
        </div>
        <div className="flex justify-between">
          <span>Highway:</span>
          <span>{Math.round(route.metadata.highwayMiles / route.metadata.totalDistanceMiles * 100)}%</span>
        </div>
        {route.metadata.tollRoadMiles > 0 && (
          <div className="flex justify-between text-yellow-600">
            <span>Tolls:</span>
            <span>{route.metadata.tollRoadMiles.toFixed(1)} mi</span>
          </div>
        )}
      </div>
      
      <div className="mt-3 flex gap-2">
        <RiskBadge label="Traffic" score={route.metadata.trafficRiskScore} />
        <RiskBadge label="Weather" score={route.metadata.weatherRiskScore} />
      </div>
      
      <div className="mt-2 text-xs text-gray-500">
        Confidence: {route.liveConditions.confidence}
      </div>
    </div>
  );
};
```

---

### B. Dynamic Rerouting During Long-Haul

#### Continuous Evaluation Engine

**File:** `hooks/useReroutingEngine.ts` (NEW - extracted from useShipmentData)

```typescript
interface RerouteEvaluation {
  shouldReroute: boolean;
  confidence: ConfidenceLevel;
  timeSavings: number;              // Minutes
  newRoute: RouteOption;
  reason: string;
  historicalAccuracy: number;       // 0-100% (based on past predictions)
}

export function useReroutingEngine(
  shipment: Shipment,
  truckPosition: Coordinates,
  currentRoute: RouteOption,
  role: UserRole
) {
  const [rerouteEval, setRerouteEval] = useState<RerouteEvaluation | null>(null);
  const [evaluationInterval, setEvaluationInterval] = useState(120000); // 2 min default
  
  // Continuous evaluation loop
  useEffect(() => {
    if (role !== UserRole.MANAGER) return; // Only for managers
    
    const evaluateRerouting = async () => {
      console.log('🔄 Evaluating rerouting options...');
      
      // 1. Get current destination (next uncompleted stop)
      const nextStop = getNextPendingStop(shipment);
      if (!nextStop) return;
      
      // 2. Generate alternative routes from current position
      const alternatives = await generateAlternativeRoutes(
        truckPosition,
        nextStop.location,
        { includeHighways: true, includeTolls: true, maxAlternatives: 3 }
      );
      
      // 3. Compare current route vs best alternative
      const currentRemaining = getCurrentRouteRemaining(currentRoute, truckPosition);
      const bestAlternative = alternatives.routes[0];
      
      const timeDiff = currentRemaining.eta - bestAlternative.metadata.currentETAMinutes;
      
      // 4. ML-based confidence using historical data
      const historicalData = await getHistoricalRerouteAccuracy(truckPosition, nextStop.location);
      const confidence = calculateRerouteConfidence({
        timeSavings: timeDiff,
        trafficData: await fetchRealTrafficData(truckPosition),
        weatherData: await fetchRealWeatherData(truckPosition),
        historicalAccuracy: historicalData.avgAccuracy,
        routeSimilarity: calculateRouteSimilarity(currentRoute, bestAlternative)
      });
      
      // 5. Threshold check: Only suggest if >5 min savings AND confidence >60%
      if (timeDiff > 5 && confidence.level !== ConfidenceLevel.LOW) {
        setRerouteEval({
          shouldReroute: true,
          confidence: confidence.level,
          timeSavings: timeDiff,
          newRoute: bestAlternative,
          reason: buildRerouteReason(currentRemaining, bestAlternative, confidence),
          historicalAccuracy: historicalData.avgAccuracy
        });
      } else {
        setRerouteEval(null); // Clear suggestion
      }
    };
    
    // Initial evaluation
    evaluateRerouting();
    
    // Re-evaluate every 2 minutes (or dynamically based on traffic changes)
    const interval = setInterval(evaluateRerouting, evaluationInterval);
    return () => clearInterval(interval);
    
  }, [truckPosition, currentRoute, shipment, role]);
  
  return rerouteEval;
}

function calculateRerouteConfidence(params: {
  timeSavings: number;
  trafficData: TrafficData | null;
  weatherData: WeatherData | null;
  historicalAccuracy: number;
  routeSimilarity: number;
}): { level: ConfidenceLevel; score: number } {
  // Hybrid confidence scoring
  let score = 0;
  
  // 1. Historical accuracy weight (40%)
  score += (params.historicalAccuracy / 100) * 0.4;
  
  // 2. Live data quality (30%)
  const liveDataQuality = (params.trafficData ? 0.5 : 0) + (params.weatherData ? 0.5 : 0);
  score += liveDataQuality * 0.3;
  
  // 3. Time savings magnitude (20%)
  const savingsScore = Math.min(params.timeSavings / 30, 1.0); // Cap at 30 min
  score += savingsScore * 0.2;
  
  // 4. Route familiarity (10%)
  score += params.routeSimilarity * 0.1;
  
  // Map to confidence levels
  if (score >= 0.75) return { level: ConfidenceLevel.HIGH, score };
  if (score >= 0.50) return { level: ConfidenceLevel.MEDIUM, score };
  return { level: ConfidenceLevel.LOW, score };
}
```

#### Manager Control UI

**File:** `components/RerouteNotification.tsx` (NEW)

```typescript
interface RerouteNotificationProps {
  evaluation: RerouteEvaluation;
  currentRoute: RouteOption;
  onAccept: () => void;
  onReject: () => void;
}

const RerouteNotification: React.FC<RerouteNotificationProps> = ({
  evaluation, currentRoute, onAccept, onReject
}) => {
  const [showDetails, setShowDetails] = useState(false);
  
  return (
    <div className="reroute-notification bg-gradient-to-r from-blue-100 to-indigo-100 border-l-4 border-indigo-600 p-4 rounded-lg shadow-lg animate-slide-in">
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <Icon name="zap" className="h-6 w-6 text-indigo-600 mt-1" />
          <div>
            <p className="font-bold text-indigo-900">Faster Route Available</p>
            <p className="text-sm text-indigo-700 mt-1">
              Save <span className="font-bold text-lg">{Math.round(evaluation.timeSavings)} minutes</span> by switching routes
            </p>
            <p className="text-xs text-gray-600 mt-1">{evaluation.reason}</p>
          </div>
        </div>
        
        <button onClick={() => setShowDetails(!showDetails)} className="text-indigo-600">
          {showDetails ? '▼' : '▶'}
        </button>
      </div>
      
      {showDetails && (
        <div className="mt-4 space-y-3 border-t border-indigo-200 pt-3">
          {/* Comparison Table */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-white p-3 rounded border border-gray-200">
              <p className="text-xs text-gray-500 mb-2">Current Route</p>
              <p className="font-bold">{currentRoute.metadata.currentETAMinutes} min</p>
              <p className="text-xs">{currentRoute.metadata.totalDistanceMiles.toFixed(1)} miles</p>
            </div>
            <div className="bg-indigo-50 p-3 rounded border border-indigo-300">
              <p className="text-xs text-indigo-600 mb-2">New Route</p>
              <p className="font-bold text-indigo-900">{evaluation.newRoute.metadata.currentETAMinutes} min</p>
              <p className="text-xs text-indigo-700">{evaluation.newRoute.metadata.totalDistanceMiles.toFixed(1)} miles</p>
            </div>
          </div>
          
          {/* Confidence & Historical Data */}
          <div className="flex items-center space-x-2 text-xs">
            <Icon name="shield-check" className="h-4 w-4 text-green-600" />
            <span>Confidence: <strong>{evaluation.confidence}</strong></span>
            <span className="text-gray-500">•</span>
            <span>Historical Accuracy: <strong>{evaluation.historicalAccuracy.toFixed(0)}%</strong></span>
          </div>
          
          {/* Live Conditions */}
          <div className="text-xs text-gray-600">
            <p>Traffic: {evaluation.newRoute.liveConditions.currentTrafficLevel}</p>
            <p>Weather: {evaluation.newRoute.liveConditions.weatherCondition}</p>
          </div>
        </div>
      )}
      
      {/* Action Buttons */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={onAccept}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded transition"
        >
          Accept New Route
        </button>
        <button
          onClick={onReject}
          className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition"
        >
          Keep Current
        </button>
      </div>
    </div>
  );
};
```

---

### C. Last-Mile Stop Resequencing

#### Backend ML Integration

**File:** `ml-backend/app/routers/reroute.py` (ENHANCE EXISTING)

```python
@router.post("/api/reroute/last-mile")
async def optimize_last_mile_sequence(request: LastMileRerouteRequest) -> LastMileRerouteResponse:
    """
    Use trained GNN model to optimize stop sequence
    """
    # Load trained route optimization model
    if TRAINED_MODEL is None:
        logger.warning("ML model not loaded, using heuristic")
        return heuristic_last_mile_optimization(request)
    
    try:
        # 1. Build graph representation of stops
        graph_data = build_stop_graph(
            current_location=request.currentLocation,
            stops=request.remainingStops,
            traffic=request.currentTraffic,
            weather=request.currentWeather
        )
        
        # 2. Run ML model prediction
        with torch.no_grad():
            scores = TRAINED_MODEL(graph_data)  # Shape: [num_stops, num_stops]
            
            # Extract optimal sequence using greedy decoding
            optimized_sequence = greedy_decode_sequence(scores, len(request.remainingStops))
        
        # 3. Calculate ETAs for optimized sequence
        optimized_etas = calculate_sequence_etas(
            current_location=request.currentLocation,
            sequence=optimized_sequence,
            stops=request.remainingStops,
            traffic_multiplier=get_traffic_multiplier(request.currentTraffic.congestionLevel)
        )
        
        # 4. Calculate original sequence ETAs for comparison
        original_sequence = [stop.id for stop in request.remainingStops]
        original_etas = calculate_sequence_etas(
            current_location=request.currentLocation,
            sequence=original_sequence,
            stops=request.remainingStops,
            traffic_multiplier=get_traffic_multiplier(request.currentTraffic.congestionLevel)
        )
        
        # 5. Compare savings
        optimized_total = max(optimized_etas.values())
        original_total = max(original_etas.values())
        time_savings = original_total - optimized_total
        
        # 6. Calculate confidence based on model attention scores
        confidence = calculate_resequence_confidence(
            scores=scores,
            time_savings=time_savings,
            num_stops=len(request.remainingStops)
        )
        
        return {
            "optimizedSequence": optimized_sequence,
            "originalSequence": original_sequence,
            "optimizedETAs": optimized_etas,
            "originalETAs": original_etas,
            "timeSavings": time_savings,
            "confidence": confidence,
            "method": "ml",
            "reason": build_resequence_reason(optimized_sequence, original_sequence, time_savings),
            "alternatives": generate_top_k_sequences(scores, k=3)  # Show 3 best options
        }
        
    except Exception as e:
        logger.error(f"ML last-mile optimization failed: {e}", exc_info=True)
        return heuristic_last_mile_optimization(request)

def build_resequence_reason(optimized: List[str], original: List[str], savings: float) -> str:
    """Generate human-readable explanation of resequencing"""
    if savings < 3:
        return "Minor optimization: Current sequence is nearly optimal."
    
    # Find major swaps
    swaps = []
    for i, (opt_id, orig_id) in enumerate(zip(optimized, original)):
        if opt_id != orig_id:
            swaps.append(f"Stop {i+1}")
    
    if len(swaps) == 2:
        return f"Swapping {swaps[0]} and {swaps[1]} saves {savings:.1f} minutes due to traffic conditions."
    elif len(swaps) > 2:
        return f"Reordering {len(swaps)} stops avoids heavy traffic zones, saving {savings:.1f} minutes."
    else:
        return f"Route optimization saves {savings:.1f} minutes."
```

#### Frontend Drag-and-Drop UI

**File:** `components/StopSequencer.tsx` (NEW)

```typescript
import { DndContext, closestCenter, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface StopSequencerProps {
  stops: Stop[];
  optimizedSequence: string[] | null;  // ML suggestion
  onSequenceChange: (newSequence: string[]) => void;
  onAcceptOptimization: () => void;
  timeSavings: number | null;
}

const StopSequencer: React.FC<StopSequencerProps> = ({
  stops, optimizedSequence, onSequenceChange, onAcceptOptimization, timeSavings
}) => {
  const [currentSequence, setCurrentSequence] = useState(stops.map(s => s.id));
  const [showOptimization, setShowOptimization] = useState(false);
  
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    
    const oldIndex = currentSequence.indexOf(active.id as string);
    const newIndex = currentSequence.indexOf(over.id as string);
    
    const newSequence = arrayMove(currentSequence, oldIndex, newIndex);
    setCurrentSequence(newSequence);
    onSequenceChange(newSequence);
  };
  
  return (
    <div className="stop-sequencer">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold">Last-Mile Stop Sequence</h3>
        <button
          onClick={() => setShowOptimization(!showOptimization)}
          className="text-sm text-indigo-600 hover:underline"
        >
          {showOptimization ? 'Hide' : 'Show'} AI Optimization
        </button>
      </div>
      
      {/* ML Optimization Suggestion */}
      {showOptimization && optimizedSequence && timeSavings && timeSavings > 3 && (
        <div className="bg-green-50 border border-green-300 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-bold text-green-900">AI Suggests Reordering</p>
              <p className="text-sm text-green-700 mt-1">
                Save <strong>{timeSavings.toFixed(0)} minutes</strong> by optimizing sequence
              </p>
            </div>
            <button
              onClick={onAcceptOptimization}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-bold"
            >
              Apply Optimization
            </button>
          </div>
          
          {/* Side-by-side comparison */}
          <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
            <div>
              <p className="font-bold mb-1">Current Order:</p>
              <ol className="list-decimal list-inside space-y-1">
                {currentSequence.map(id => {
                  const stop = stops.find(s => s.id === id);
                  return <li key={id}>{stop?.name}</li>;
                })}
              </ol>
            </div>
            <div>
              <p className="font-bold mb-1 text-green-700">Optimized Order:</p>
              <ol className="list-decimal list-inside space-y-1 text-green-700">
                {optimizedSequence.map(id => {
                  const stop = stops.find(s => s.id === id);
                  return <li key={id}>{stop?.name}</li>;
                })}
              </ol>
            </div>
          </div>
        </div>
      )}
      
      {/* Draggable Stop List */}
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={currentSequence} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {currentSequence.map((stopId, index) => {
              const stop = stops.find(s => s.id === stopId)!;
              return (
                <SortableStopItem
                  key={stopId}
                  stop={stop}
                  index={index}
                  isOptimized={optimizedSequence?.[index] === stopId}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      
      <p className="text-xs text-gray-500 mt-4">
        💡 Drag stops to manually reorder, or use AI optimization above
      </p>
    </div>
  );
};

const SortableStopItem: React.FC<{stop: Stop, index: number, isOptimized: boolean}> = ({
  stop, index, isOptimized
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stop.id });
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`stop-item flex items-center p-3 bg-white border rounded-lg cursor-move hover:shadow-md transition ${
        isOptimized ? 'border-green-500 bg-green-50' : 'border-gray-300'
      }`}
    >
      <span className="font-bold text-gray-500 mr-3">{index + 1}</span>
      <Icon name="grip-vertical" className="h-5 w-5 text-gray-400 mr-3" />
      <div className="flex-1">
        <p className="font-medium">{stop.name}</p>
        <p className="text-xs text-gray-500">{stop.unloadingTimeMinutes || 0} min unloading</p>
      </div>
      {isOptimized && (
        <Icon name="check-circle" className="h-5 w-5 text-green-500" />
      )}
    </div>
  );
};
```

**Install Required Package:**
```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

---

## 3️⃣ PROPAGATION TO SUPPLIERS & RECEIVERS

### Event-Driven Update System

**File:** `services/rerouteEventBus.ts` (NEW)

```typescript
interface RerouteEvent {
  eventId: string;
  timestamp: Date;
  shipmentId: string;
  eventType: 'LONG_HAUL_REROUTE' | 'LAST_MILE_RESEQUENCE' | 'ROUTE_SWITCH';
  changes: {
    affectedStops: string[];            // Stop IDs
    oldETAs: Record<string, number>;    // stopId -> ETA minutes
    newETAs: Record<string, number>;
    reason: string;
  };
  triggeredBy: 'MANAGER' | 'AUTOMATIC';
}

class RerouteEventBus {
  private listeners: Map<string, ((event: RerouteEvent) => void)[]> = new Map();
  
  subscribe(shipmentId: string, callback: (event: RerouteEvent) => void) {
    if (!this.listeners.has(shipmentId)) {
      this.listeners.set(shipmentId, []);
    }
    this.listeners.get(shipmentId)!.push(callback);
  }
  
  async publishRerouteEvent(event: RerouteEvent) {
    console.log('📡 Publishing reroute event:', event);
    
    // 1. Update shipment state
    await updateShipmentETAs(event.shipmentId, event.changes.newETAs);
    
    // 2. Notify all subscribed tracking numbers
    const affectedTrackingNumbers = await getTrackingNumbersByShipment(event.shipmentId);
    
    for (const trackingNumber of affectedTrackingNumbers) {
      await sendNotification(trackingNumber, {
        type: 'ETA_UPDATE',
        message: buildNotificationMessage(trackingNumber, event),
        newETA: event.changes.newETAs[trackingNumber.stopId],
        oldETA: event.changes.oldETAs[trackingNumber.stopId]
      });
    }
    
    // 3. Trigger UI updates via listeners
    const callbacks = this.listeners.get(event.shipmentId) || [];
    callbacks.forEach(cb => cb(event));
    
    // 4. Log to history
    await logRerouteEvent(event);
  }
}

export const rerouteEventBus = new RerouteEventBus();

function buildNotificationMessage(trackingNumber: TrackingInfo, event: RerouteEvent): string {
  const role = trackingNumber.role;
  const stopId = trackingNumber.recipientStopId;
  
  if (role === UserRole.SUPPLIER) {
    return `Route optimized. Delivery ETA updated to ${event.changes.newETAs['hub']} minutes. ${event.changes.reason}`;
  }
  
  if (role === UserRole.RECIPIENT && stopId) {
    const oldETA = event.changes.oldETAs[stopId];
    const newETA = event.changes.newETAs[stopId];
    const diff = newETA - oldETA;
    
    if (event.eventType === 'LAST_MILE_RESEQUENCE') {
      const oldPosition = event.changes.affectedStops.indexOf(stopId) + 1;
      const newPosition = Object.keys(event.changes.newETAs).indexOf(stopId) + 1;
      
      return `Delivery sequence optimized. You are now stop ${newPosition} of ${event.changes.affectedStops.length}. ` +
             `New ETA: ${newETA} minutes (${diff > 0 ? '+' : ''}${diff} min). ${event.changes.reason}`;
    }
    
    return `Route updated. New ETA: ${newETA} minutes (${diff > 0 ? '+' : ''}${diff} min). ${event.changes.reason}`;
  }
  
  return `Route updated. ${event.changes.reason}`;
}
```

### Integration with Manager Actions

**File:** `hooks/useShipmentData.ts` (MODIFY)

```typescript
// Add to useShipmentData hook
const handleAcceptReroute = useCallback(async (newRoute: RouteOption) => {
  console.log('✅ Manager accepted reroute:', newRoute.id);
  
  // 1. Update active route
  setActiveRoute(newRoute);
  setDetailedFullPath(newRoute.path);
  setRoadSegments(newRoute.segments);
  
  // 2. Recalculate all ETAs with new route
  const newETAs = await calculateETAsForAllStops(shipment, newRoute);
  
  // 3. Publish reroute event
  const event: RerouteEvent = {
    eventId: crypto.randomUUID(),
    timestamp: new Date(),
    shipmentId: shipment.trackingNumber,
    eventType: 'ROUTE_SWITCH',
    changes: {
      affectedStops: fullRouteStops.map(s => s.id),
      oldETAs: currentETAs,
      newETAs: newETAs,
      reason: `Manager switched to ${newRoute.metadata.routeType} route to save ${rerouteEval?.timeSavings} minutes`
    },
    triggeredBy: 'MANAGER'
  };
  
  await rerouteEventBus.publishRerouteEvent(event);
  
  // 4. Clear reroute suggestion
  setRerouteEval(null);
  
  // 5. Show confirmation toast
  showToast('Route updated successfully. All tracking numbers notified.', 'success');
}, [shipment, rerouteEval]);

const handleAcceptResequence = useCallback(async (newSequence: string[]) => {
  console.log('✅ Manager accepted stop resequencing:', newSequence);
  
  // 1. Reorder last-mile stops
  const reorderedStops = newSequence.map(id => 
    shipment.lastMileStops.find(s => s.id === id)!
  );
  
  setShipment(prev => ({
    ...prev,
    lastMileStops: reorderedStops
  }));
  
  // 2. Recalculate ETAs
  const newETAs = await calculateLastMileETAs(reorderedStops);
  
  // 3. Publish event
  const event: RerouteEvent = {
    eventId: crypto.randomUUID(),
    timestamp: new Date(),
    shipmentId: shipment.trackingNumber,
    eventType: 'LAST_MILE_RESEQUENCE',
    changes: {
      affectedStops: newSequence,
      oldETAs: originalLastMileETAs,
      newETAs: newETAs,
      reason: 'Route optimized due to traffic conditions'
    },
    triggeredBy: 'MANAGER'
  };
  
  await rerouteEventBus.publishRerouteEvent(event);
  
  // 4. Update UI
  showToast('Stop sequence updated. Recipients notified of new delivery order.', 'success');
}, [shipment]);
```

---

## 4️⃣ TRACKING NUMBER & DATABASE REDESIGN

### Root Cause Analysis

**Current Issues:**
1. ❌ Tracking numbers stored in-memory (`App.tsx` state)
2. ❌ Shipments lost on page refresh
3. ❌ No persistent ID generation (UUIDs regenerated each time)
4. ❌ No separation between "tracking number" (access key) and "shipment" (business entity)
5. ❌ No soft delete or lifecycle management
6. ❌ No route history or audit trail

### Proposed Database Schema

```sql
-- Core Entities

CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number VARCHAR(50) UNIQUE NOT NULL,  -- Business ID (SHIP-ABC123)
  status VARCHAR(50) NOT NULL,                   -- PENDING, IN_TRANSIT, DELIVERED, etc.
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMP NULL,                     -- Soft delete
  
  -- Origin/Destination
  origin_stop_id UUID NOT NULL REFERENCES stops(id),
  hub_stop_id UUID NOT NULL REFERENCES stops(id),
  
  -- Current state
  current_leg_index INTEGER NOT NULL DEFAULT 0,
  active_route_plan_id UUID REFERENCES route_plans(id),
  
  INDEX idx_tracking_number (tracking_number),
  INDEX idx_status (status),
  INDEX idx_deleted_at (deleted_at)
);

CREATE TABLE stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  unloading_time_minutes INTEGER DEFAULT 0,
  stop_type VARCHAR(50) NOT NULL,  -- ORIGIN, LONG_HAUL, HUB, LAST_MILE
  status VARCHAR(50) NOT NULL,      -- PENDING, IN_PROGRESS, COMPLETED, UNLOADING
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  sequence_order INTEGER NOT NULL,  -- Order in route
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_shipment_id (shipment_id),
  INDEX idx_status (status)
);

CREATE TABLE shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  contents TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  destination_stop_id UUID NOT NULL REFERENCES stops(id),
  
  INDEX idx_shipment_id (shipment_id)
);

-- Route Planning

CREATE TABLE route_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  plan_type VARCHAR(50) NOT NULL,    -- LONG_HAUL, LAST_MILE
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  replaced_at TIMESTAMP NULL,        -- When superseded by new plan
  
  -- Route metadata
  total_distance_miles DECIMAL(10, 2),
  base_eta_minutes INTEGER,
  
  INDEX idx_shipment_id (shipment_id),
  INDEX idx_is_active (is_active)
);

CREATE TABLE route_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_plan_id UUID NOT NULL REFERENCES route_plans(id) ON DELETE CASCADE,
  option_rank INTEGER NOT NULL,      -- 1 = recommended, 2-4 = alternatives
  route_type VARCHAR(50),             -- FASTEST, SHORTEST, TOLL_FREE, BALANCED
  
  -- Geometry (stored as JSON or PostGIS geometry)
  path_geojson JSONB NOT NULL,       -- Array of [lat, lon] coordinates
  segments_data JSONB,                -- Road segment metadata
  
  -- Metadata
  total_distance_miles DECIMAL(10, 2),
  base_eta_minutes INTEGER,
  current_eta_minutes INTEGER,
  toll_road_miles DECIMAL(10, 2),
  highway_miles DECIMAL(10, 2),
  avg_speed_limit INTEGER,
  traffic_risk_score DECIMAL(3, 2),
  weather_risk_score DECIMAL(3, 2),
  
  -- Live conditions (updated periodically)
  traffic_level VARCHAR(50),
  weather_condition VARCHAR(100),
  estimated_delay_minutes INTEGER,
  confidence_level VARCHAR(50),
  last_evaluated_at TIMESTAMP,
  
  INDEX idx_route_plan_id (route_plan_id)
);

-- Reroute Event History

CREATE TABLE reroute_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,   -- LONG_HAUL_REROUTE, LAST_MILE_RESEQUENCE, ROUTE_SWITCH
  triggered_by VARCHAR(50) NOT NULL, -- MANAGER, AUTOMATIC
  
  -- What changed
  old_route_plan_id UUID REFERENCES route_plans(id),
  new_route_plan_id UUID REFERENCES route_plans(id),
  affected_stops JSONB,               -- Array of stop IDs
  eta_changes JSONB,                  -- { stopId: { old: 60, new: 45 } }
  reason TEXT,
  
  -- Metadata
  time_savings_minutes INTEGER,
  confidence_level VARCHAR(50),
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  INDEX idx_shipment_id (shipment_id),
  INDEX idx_event_type (event_type)
);

-- Tracking Number Access Control

CREATE TABLE tracking_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code VARCHAR(50) UNIQUE NOT NULL,  -- MGR-ABC123, SUP-XYZ789, etc.
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,                   -- MANAGER, SUPPLIER, RECIPIENT
  recipient_stop_id UUID REFERENCES stops(id), -- For recipient tracking numbers
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMP,
  access_count INTEGER NOT NULL DEFAULT 0,
  
  -- Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  revoked_at TIMESTAMP NULL,
  
  INDEX idx_tracking_code (tracking_code),
  INDEX idx_shipment_id (shipment_id),
  INDEX idx_is_active (is_active)
);

-- ETA History (for analytics & confidence scoring)

CREATE TABLE eta_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  stop_id UUID NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
  
  predicted_eta_minutes INTEGER NOT NULL,
  actual_arrival_minutes INTEGER,              -- NULL until arrival
  prediction_method VARCHAR(50),                -- ML, PHYSICS, HYBRID
  confidence_level VARCHAR(50),
  
  predicted_at TIMESTAMP NOT NULL,
  actual_arrival_at TIMESTAMP NULL,
  
  -- Conditions at prediction time
  traffic_level VARCHAR(50),
  weather_condition VARCHAR(100),
  
  INDEX idx_shipment_id (shipment_id),
  INDEX idx_stop_id (stop_id)
);

-- Notifications (outbox pattern for reliable delivery)

CREATE TABLE notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number_id UUID NOT NULL REFERENCES tracking_numbers(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL,  -- ETA_UPDATE, REROUTE, DELAY_ALERT
  message TEXT NOT NULL,
  payload JSONB,                            -- Additional data
  
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',  -- PENDING, SENT, FAILED
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);
```

### How This Fixes Issues

| Problem | Solution |
|---------|----------|
| **Tracking numbers lost on restart** | Stored in `tracking_numbers` table with persistent IDs |
| **Can't reuse tracking number** | `tracking_code` has UNIQUE constraint but can be reactivated |
| **No shipment lifecycle** | `deleted_at` for soft delete, `status` for state machine |
| **No route history** | `reroute_events` table logs all changes with timestamps |
| **Can't support multi-route** | `route_plans` + `route_options` stores all alternatives |
| **No analytics** | `eta_history` tracks predictions vs actuals for ML training |

### Implementation Strategy

**Phase 1: Add Persistence Layer (1 week)**
- Set up PostgreSQL database
- Create schema with migrations
- Implement repository pattern (`ShipmentRepository`, `TrackingNumberRepository`)

**Phase 2: Migrate Current Data (2 days)**
- Add database connector to frontend
- Migrate `INITIAL_SHIPMENT` to database on first load
- Update `handleTrack()` to query database instead of in-memory map

**Phase 3: Event Sourcing (3 days)**
- Implement `RerouteEventBus` with database backing
- Log all route changes to `reroute_events`
- Build notification system using `notification_queue`

**Phase 4: Multi-Route Support (1 week)**
- Implement `route_plans` and `route_options` storage
- Update frontend to load/display multiple routes
- Connect manager UI to database

---

## 🎯 IMPLEMENTATION PRIORITY

### **Phase 1: Critical Path (Week 1)**
✅ **Already Done:**
- ML models trained (ETA 92.8%, Route 87.5%)
- ML backend operational
- Basic reroute UI exists

🔨 **Immediate Tasks:**
1. Create `services/multiRouteService.ts` - OSRM alternative routes
2. Create `components/RouteSelector.tsx` - Multi-route UI
3. Enhance `ml-backend/app/routers/multi_route.py` - Alternative route generation
4. Add database schema and persistence

### **Phase 2: Dynamic Rerouting (Week 2)**
1. Extract `hooks/useReroutingEngine.ts` from `useShipmentData`
2. Implement continuous evaluation (every 2 min)
3. Add `components/RerouteNotification.tsx`
4. Connect accept/reject handlers

### **Phase 3: Last-Mile Optimization (Week 3)**
1. Install `@dnd-kit` packages
2. Create `components/StopSequencer.tsx`
3. Enhance backend `/api/reroute/last-mile` with ML model loading
4. Integrate with manager dashboard

### **Phase 4: Propagation System (Week 4)**
1. Implement `services/rerouteEventBus.ts`
2. Add notification system
3. Update all tracking views to subscribe to events
4. Build audit trail UI

---

## 📊 SUCCESS METRICS

- **Long-Haul:** Manager can see 3-4 route options within 2 seconds
- **Dynamic Reroute:** Suggestions appear when >5 min savings available
- **Last-Mile:** Drag-and-drop works smoothly, ML suggestions < 1 second
- **Propagation:** Tracking number updates within 500ms of manager action
- **Persistence:** Tracking numbers survive page refresh/server restart

---

## 🔐 SECURITY & PERMISSIONS

- Managers: Full reroute control, see all routes
- Suppliers: Notified of changes, no control
- Recipients: Notified of ETA changes, no route details

**Would you like me to start implementing any specific phase?** I can begin with:
1. Multi-route service + UI
2. Database migration
3. Last-mile drag-and-drop
4. Event propagation system

Let me know which component to build first!
