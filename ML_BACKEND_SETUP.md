# ML Backend Setup for LaDe-based Rerouting

This document explains how to set up the ML backend for intelligent last-mile rerouting using LaDe models trained on the Cainiao-AI dataset.

## Architecture

```
Frontend (React) → ML Backend (FastAPI/Python) → LaDe Models (Cainiao-AI trained) → Route Optimization
                                                ↓
                                        PostgreSQL/Redis (Caching)
```

## Dataset Information

**Source**: [Cainiao-AI/LaDe Dataset](https://huggingface.co/datasets/Cainiao-AI/LaDe)

The dataset contains:
- **Real logistics trajectories** from delivery operations
- **Spatiotemporal features**: GPS coordinates, timestamps, road segments
- **Contextual data**: Traffic conditions, weather, time-of-day
- **ETA labels**: Actual delivery times for supervised learning
- **Graph structures**: Road network topology and connectivity

This is perfect for training models on:
1. Last-mile delivery ETA prediction
2. Route optimization under various conditions
3. Traffic-aware routing decisions

## Backend Structure

```
ml-backend/
├── app/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app
│   ├── models/
│   │   ├── __init__.py
│   │   ├── lade_model.py          # LaDe model wrapper
│   │   └── route_optimizer.py     # Route optimization logic
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes.py              # API endpoints
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py              # Configuration
│   │   └── cache.py               # Redis caching
│   └── utils/
│       ├── __init__.py
│       ├── trajectory.py          # Trajectory processing
│       └── graph.py               # Road network graph
├── data/
│   ├── road_network/              # Road network data
│   ├── historical/                # Historical trajectory data
│   └── models/                    # Trained model weights
├── requirements.txt
├── Dockerfile
└── README.md
```

## Installation Steps

### 1. Clone LaDe Repository & Download Dataset

```bash
# Clone the LaDe repository
git clone https://github.com/wenhaomin/LaDe.git
cd LaDe

# Install Hugging Face datasets library
pip install datasets huggingface_hub

# Download Cainiao-AI/LaDe dataset
python -c "
from datasets import load_dataset
dataset = load_dataset('Cainiao-AI/LaDe', split='train')
dataset.save_to_disk('data/cainiao_dataset')
print(f'Downloaded {len(dataset)} trajectory samples')
"
```

### Dataset Structure

The Cainiao-AI/LaDe dataset includes:

```python
# Example trajectory data structure
{
    'trajectory_id': 'TRJ_12345',
    'coordinates': [[lat1, lon1], [lat2, lon2], ...],  # GPS trajectory
    'timestamps': [t1, t2, t3, ...],                    # Unix timestamps
    'road_segments': ['seg_1', 'seg_2', ...],           # Road segment IDs
    'traffic_conditions': [0.7, 0.8, 0.6, ...],        # Traffic speed ratios
    'weather': 'clear|rain|storm',                      # Weather condition
    'time_of_day': 'morning|afternoon|evening|night',   # Time category
    'day_of_week': 1-7,                                 # Day (1=Monday)
    'eta_seconds': 3600,                                # Actual time taken
    'distance_km': 15.2,                                # Total distance
    'num_stops': 5,                                     # Number of delivery stops
    'stop_sequence': ['stop_1', 'stop_2', ...],        # Stop order
    'stop_coordinates': [[lat, lon], ...],              # Stop locations
}
```

### 2. Create Python Backend

Create `ml-backend/requirements.txt`:

```txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
torch==2.1.0
numpy==1.24.3
pandas==2.0.3
scipy==1.11.3
redis==5.0.1
pydantic==2.5.0
python-dotenv==1.0.0
ortools==9.8.3296  # For route optimization
networkx==3.2.1
```

### 3. Create FastAPI Backend (`ml-backend/app/main.py`)

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import torch
import numpy as np
from datetime import datetime

# Import LaDe models (after setting up LaDe repo)
# from models.lade_model import LaDEPredictor
# from models.route_optimizer import RouteOptimizer

app = FastAPI(title="Logistics ML Backend", version="1.0.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request/Response Models
class Location(BaseModel):
    lat: float
    lon: float

class Stop(BaseModel):
    id: str
    location: List[float]  # [lat, lon]
    name: str
    priority: str = "normal"

class TrafficCondition(BaseModel):
    status: str
    currentSpeed: float
    description: Optional[str] = None

class RouteOptimizationRequest(BaseModel):
    current_location: List[float]
    stops: List[Stop]
    trajectory_features: dict
    time_of_day: str
    day_of_week: str
    traffic_condition: Optional[TrafficCondition] = None
    weather_condition: Optional[dict] = None

class RouteOptimizationResponse(BaseModel):
    optimized_stop_order: List[str]
    predicted_etas: List[float]
    time_savings_minutes: float
    confidence: float
    reasoning: str
    alternative_routes: Optional[List[dict]] = None

# Initialize models (would load LaDe weights)
# lade_predictor = LaDEPredictor(model_path="data/models/lade_weights.pth")
# route_optimizer = RouteOptimizer(lade_predictor)

@app.post("/api/optimize-route", response_model=RouteOptimizationResponse)
async def optimize_route(request: RouteOptimizationRequest):
    """
    Optimize last-mile delivery route using LaDe ETA predictions
    """
    try:
        # Extract features
        current_loc = request.current_location
        stops = request.stops
        
        if len(stops) < 2:
            raise HTTPException(400, "Need at least 2 stops to optimize")
        
        # Feature extraction for LaDe model
        features = extract_trajectory_features(
            current_loc,
            stops,
            request.trajectory_features,
            request.traffic_condition,
            request.weather_condition
        )
        
        # Use LaDe to predict ETA for all possible routes
        # This is where LaDe models would be called
        # For now, using heuristic optimization
        
        optimized_result = optimize_stop_sequence(
            current_loc,
            stops,
            features,
            request.traffic_condition
        )
        
        return RouteOptimizationResponse(**optimized_result)
        
    except Exception as e:
        raise HTTPException(500, f"Route optimization failed: {str(e)}")

def extract_trajectory_features(current_loc, stops, traj_features, traffic, weather):
    """
    Extract features for LaDe model input
    """
    features = {
        "current_location": current_loc,
        "num_stops": len(stops),
        "time_of_day_embedding": encode_time_of_day(datetime.now()),
        "day_of_week": datetime.now().weekday(),
        "traffic_speed": traffic.currentSpeed if traffic else 30.0,
        "traffic_level": encode_traffic_level(traffic.status if traffic else "Light"),
        "weather_condition": encode_weather(weather.get("condition") if weather else "Clear"),
        "stop_locations": [s.location for s in stops],
        "stop_priorities": [1.0 if s.priority == "high" else 0.5 for s in stops]
    }
    return features

def encode_time_of_day(dt):
    """Encode time as sin/cos for cyclical feature"""
    hour = dt.hour + dt.minute / 60.0
    return {
        "sin": np.sin(2 * np.pi * hour / 24),
        "cos": np.cos(2 * np.pi * hour / 24)
    }

def encode_traffic_level(status: str) -> float:
    """Encode traffic status as numerical value"""
    mapping = {"Light": 0.2, "Moderate": 0.5, "Heavy": 0.8, "Unknown": 0.4}
    return mapping.get(status, 0.4)

def encode_weather(condition: str) -> float:
    """Encode weather condition"""
    mapping = {"Clear": 0.0, "Rain": 0.5, "Storm": 1.0}
    return mapping.get(condition, 0.0)

def optimize_stop_sequence(current_loc, stops, features, traffic):
    """
    Optimize delivery sequence using nearest neighbor + ETA predictions
    This is a placeholder - would use LaDe predictions in production
    """
    from itertools import permutations
    
    # For small number of stops, try all permutations
    if len(stops) <= 6:
        best_route = find_best_permutation(current_loc, stops, features, traffic)
    else:
        # For larger routes, use greedy nearest neighbor
        best_route = nearest_neighbor_with_traffic(current_loc, stops, features, traffic)
    
    return best_route

def find_best_permutation(current_loc, stops, features, traffic):
    """Try all permutations for small routes"""
    best_order = None
    best_time = float('inf')
    
    for perm in permutations(stops):
        total_time = estimate_route_time(current_loc, list(perm), features, traffic)
        if total_time < best_time:
            best_time = total_time
            best_order = perm
    
    # Calculate original route time
    original_time = estimate_route_time(current_loc, stops, features, traffic)
    
    return {
        "optimized_stop_order": [s.id for s in best_order],
        "predicted_etas": calculate_etas(current_loc, list(best_order), features),
        "time_savings_minutes": max(0, original_time - best_time),
        "confidence": 0.85,
        "reasoning": f"Optimized route using traffic-aware sequencing. Original: {original_time:.1f}min, Optimized: {best_time:.1f}min"
    }

def nearest_neighbor_with_traffic(current_loc, stops, features, traffic):
    """Greedy nearest neighbor with traffic penalties"""
    unvisited = list(stops)
    route = []
    current = current_loc
    total_time = 0
    
    while unvisited:
        # Find nearest stop considering traffic
        nearest_idx = 0
        min_cost = float('inf')
        
        for i, stop in enumerate(unvisited):
            distance = haversine_distance(current, stop.location)
            traffic_penalty = 1.5 if traffic and traffic.currentSpeed < 30 else 1.0
            cost = distance * traffic_penalty
            
            if cost < min_cost:
                min_cost = cost
                nearest_idx = i
        
        next_stop = unvisited.pop(nearest_idx)
        route.append(next_stop)
        
        # Estimate time to this stop
        dist = haversine_distance(current, next_stop.location)
        speed = traffic.currentSpeed if traffic else 40.0
        time = (dist / speed) * 60  # minutes
        total_time += time
        
        current = next_stop.location
    
    original_time = estimate_route_time(current_loc, stops, features, traffic)
    
    return {
        "optimized_stop_order": [s.id for s in route],
        "predicted_etas": calculate_etas(current_loc, route, features),
        "time_savings_minutes": max(0, original_time - total_time),
        "confidence": 0.75,
        "reasoning": "Route optimized using nearest-neighbor heuristic with traffic awareness"
    }

def estimate_route_time(start, stops, features, traffic):
    """Estimate total time for a route"""
    total_time = 0
    current = start
    base_speed = traffic.currentSpeed if traffic else 40.0
    
    for stop in stops:
        dist = haversine_distance(current, stop.location)
        time = (dist / base_speed) * 60
        total_time += time
        current = stop.location
    
    return total_time

def calculate_etas(start, stops, features):
    """Calculate ETA to each stop"""
    etas = []
    current = start
    cumulative_time = 0
    
    for stop in stops:
        dist = haversine_distance(current, stop.location)
        time = (dist / 40.0) * 60  # Assume 40 mph average
        cumulative_time += time
        etas.append(round(cumulative_time))
        current = stop.location
    
    return etas

def haversine_distance(coord1, coord2):
    """Calculate distance in miles"""
    R = 3959  # Earth radius in miles
    lat1, lon1 = np.radians(coord1)
    lat2, lon2 = np.radians(coord2)
    
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1-a))
    
    return R * c

@app.get("/health")
async def health_check():
    return {"status": "healthy", "model": "LaDe v1.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 4. Run Backend

```bash
# Install dependencies
pip install -r requirements.txt

# Run server
python ml-backend/app/main.py
```

### 5. Configure Frontend

Add to `.env.local`:
```
VITE_ML_BACKEND_URL=http://localhost:8000
```

## Integration with LaDe Models

To fully integrate LaDe:

1. **Train LaDe on your delivery data**: Collect historical trajectory data from your logistics operations

2. **Adapt model inputs**: Modify LaDe to accept your specific features (stops, traffic, weather)

3. **Create route scorer**: Use LaDe's ETA predictions to score different route permutations

4. **Deploy with caching**: Cache predictions for common routes

## Benefits for Last-Mile

- **Traffic-aware sequencing**: Reorder stops based on real-time traffic
- **Time window optimization**: Prioritize urgent deliveries
- **Driver behavior learning**: Learn from historical driver patterns
- **Weather adaptation**: Adjust routes for weather conditions
- **Capacity optimization**: Consider vehicle capacity constraints

## Next Steps

1. Set up basic FastAPI backend (done with code above)
2. Collect your historical delivery data
3. Fine-tune LaDe models on your data
4. Integrate with frontend service
5. A/B test ML routing vs current routing
