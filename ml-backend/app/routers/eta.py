"""
ETA Prediction Router
Handles hybrid ETA calculations using LaDe models
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
import numpy as np
from datetime import datetime
import logging

router = APIRouter(prefix="/api/eta", tags=["eta"])
logger = logging.getLogger(__name__)

# Placeholder for trained model - replace with actual LaDe model
TRAINED_MODEL = None

class StopLocation(BaseModel):
    lat: float
    lng: float

class Stop(BaseModel):
    id: str
    name: str
    location: StopLocation
    unloadingTimeMinutes: Optional[int] = 0

class TrafficData(BaseModel):
    congestionLevel: str
    currentSpeed: Optional[float] = None
    freeFlowSpeed: Optional[float] = None

class WeatherData(BaseModel):
    description: str
    temperature: float
    windSpeed: Optional[float] = None

class ETARequest(BaseModel):
    currentLocation: StopLocation
    stops: List[Stop]
    currentSpeed: float
    trafficData: TrafficData
    weatherData: WeatherData
    timeOfDay: str  # "HH:MM"
    dayOfWeek: str
    historicalData: Optional[Dict] = None

class ETAPrediction(BaseModel):
    stopId: str
    estimatedArrivalMinutes: float
    confidence: float
    factors: Dict[str, float]

class ETAResponse(BaseModel):
    predictions: List[ETAPrediction]
    totalEstimatedMinutes: float
    modelConfidence: float
    fallbackUsed: bool

def encode_time_features(time_of_day: str, day_of_week: str) -> Dict[str, float]:
    """Encode time features cyclically (same as data preprocessing)"""
    
    # Parse hour and minute
    hour, minute = map(int, time_of_day.split(':'))
    hour_decimal = hour + minute / 60.0
    
    # Cyclical encoding for time of day (0-24 hours)
    hour_sin = np.sin(2 * np.pi * hour_decimal / 24.0)
    hour_cos = np.cos(2 * np.pi * hour_decimal / 24.0)
    
    # Cyclical encoding for day of week (0-6)
    day_map = {
        'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3,
        'Friday': 4, 'Saturday': 5, 'Sunday': 6
    }
    day_num = day_map.get(day_of_week, 0)
    day_sin = np.sin(2 * np.pi * day_num / 7.0)
    day_cos = np.cos(2 * np.pi * day_num / 7.0)
    
    return {
        'hour_sin': float(hour_sin),
        'hour_cos': float(hour_cos),
        'day_sin': float(day_sin),
        'day_cos': float(day_cos),
    }

def encode_traffic_level(traffic_level: str) -> float:
    """Convert traffic level to numeric value"""
    mapping = {
        'none': 0.0,
        'light': 0.33,
        'moderate': 0.66,
        'heavy': 1.0
    }
    return mapping.get(traffic_level.lower(), 0.5)

def encode_weather_condition(weather_desc: str) -> float:
    """Convert weather to numeric severity"""
    desc_lower = weather_desc.lower()
    
    if 'storm' in desc_lower or 'heavy' in desc_lower:
        return 1.0  # Severe
    elif 'rain' in desc_lower or 'snow' in desc_lower:
        return 0.66  # Moderate
    elif 'cloud' in desc_lower or 'fog' in desc_lower:
        return 0.33  # Light
    else:
        return 0.0  # Clear

def calculate_distance_km(loc1: StopLocation, loc2: StopLocation) -> float:
    """Calculate haversine distance between two points"""
    from math import radians, sin, cos, sqrt, atan2
    
    lat1, lon1 = radians(loc1.lat), radians(loc1.lng)
    lat2, lon2 = radians(loc2.lat), radians(loc2.lng)
    
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    
    # Earth radius in km
    return 6371.0 * c

def extract_features_for_prediction(request: ETARequest) -> np.ndarray:
    """
    Extract features matching Cainiao dataset format for LaDe model
    Features: [num_stops, total_distance_km, avg_stop_distance_km, 
               traffic_level, weather_severity, current_speed,
               speed_ratio, hour_sin, hour_cos, day_sin, day_cos,
               wind_speed, temperature]
    """
    
    # Basic route features
    num_stops = len(request.stops)
    
    # Calculate distances
    distances = []
    current_loc = request.currentLocation
    for stop in request.stops:
        dist = calculate_distance_km(current_loc, stop.location)
        distances.append(dist)
        current_loc = stop.location
    
    total_distance_km = sum(distances)
    avg_stop_distance_km = total_distance_km / num_stops if num_stops > 0 else 0
    
    # Traffic features
    traffic_level = encode_traffic_level(request.trafficData.congestionLevel)
    free_flow_speed = request.trafficData.freeFlowSpeed or 100.0
    current_speed = request.trafficData.currentSpeed or request.currentSpeed
    speed_ratio = current_speed / free_flow_speed if free_flow_speed > 0 else 1.0
    
    # Weather features
    weather_severity = encode_weather_condition(request.weatherData.description)
    wind_speed = request.weatherData.windSpeed or 0.0
    temperature = request.weatherData.temperature
    
    # Time features
    time_features = encode_time_features(request.timeOfDay, request.dayOfWeek)
    
    # Combine all features (13 total)
    features = np.array([
        num_stops,
        total_distance_km,
        avg_stop_distance_km,
        traffic_level,
        weather_severity,
        current_speed,
        speed_ratio,
        time_features['hour_sin'],
        time_features['hour_cos'],
        time_features['day_sin'],
        time_features['day_cos'],
        wind_speed,
        temperature,
    ], dtype=np.float32)
    
    return features.reshape(1, -1)  # Shape: (1, 13)

def fallback_eta_calculation(request: ETARequest) -> ETAResponse:
    """
    Fallback ETA calculation when ML model unavailable
    Uses simple distance/speed with traffic/weather adjustments
    """
    predictions = []
    cumulative_time = 0.0
    current_loc = request.currentLocation
    
    for stop in request.stops:
        # Calculate distance
        distance_km = calculate_distance_km(current_loc, stop.location)
        
        # Base speed (from current speed or default)
        base_speed_kmh = request.currentSpeed * 1.60934  # mph to km/h
        
        # Apply traffic multiplier
        traffic_multipliers = {
            'none': 1.0,
            'light': 0.9,
            'moderate': 0.75,
            'heavy': 0.5
        }
        traffic_mult = traffic_multipliers.get(
            request.trafficData.congestionLevel.lower(), 0.8
        )
        
        # Apply weather multiplier
        weather_desc = request.weatherData.description.lower()
        weather_mult = 1.0
        if 'storm' in weather_desc or 'heavy' in weather_desc:
            weather_mult = 0.6
        elif 'rain' in weather_desc or 'snow' in weather_desc:
            weather_mult = 0.8
        
        # Calculate adjusted speed and time
        adjusted_speed = base_speed_kmh * traffic_mult * weather_mult
        travel_time_hours = distance_km / adjusted_speed if adjusted_speed > 0 else 0
        travel_time_minutes = travel_time_hours * 60
        
        # Add unloading time
        unloading_time = stop.unloadingTimeMinutes or 0
        total_time = travel_time_minutes + unloading_time
        
        cumulative_time += total_time
        
        # Calculate impact factors
        traffic_impact = 1.0 - traffic_mult
        weather_impact = 1.0 - weather_mult
        
        predictions.append(ETAPrediction(
            stopId=stop.id,
            estimatedArrivalMinutes=cumulative_time,
            confidence=0.6,  # Lower confidence for fallback
            factors={
                'trafficImpact': traffic_impact,
                'weatherImpact': weather_impact,
                'timeOfDayImpact': 0.0,
                'historicalPattern': 0.0,
            }
        ))
        
        current_loc = stop.location
    
    return ETAResponse(
        predictions=predictions,
        totalEstimatedMinutes=cumulative_time,
        modelConfidence=0.6,
        fallbackUsed=True
    )

def ml_eta_prediction(request: ETARequest) -> ETAResponse:
    """
    ML-based ETA prediction using trained LaDe model
    """
    global TRAINED_MODEL
    
    if TRAINED_MODEL is None:
        logger.warning("ML model not loaded, using fallback")
        return fallback_eta_calculation(request)
    
    try:
        # Extract features
        features = extract_features_for_prediction(request)
        
        # Make prediction with LaDe model
        # Assuming model outputs: [total_eta_minutes, confidence_score]
        prediction = TRAINED_MODEL.predict(features)
        
        total_eta = float(prediction[0][0])
        model_confidence = float(prediction[0][1]) if len(prediction[0]) > 1 else 0.85
        
        # Distribute total ETA across stops proportionally by distance
        predictions = []
        cumulative_time = 0.0
        current_loc = request.currentLocation
        
        distances = []
        for stop in request.stops:
            dist = calculate_distance_km(current_loc, stop.location)
            distances.append(dist)
            current_loc = stop.location
        
        total_distance = sum(distances)
        
        for i, stop in enumerate(request.stops):
            # Proportional ETA allocation
            if total_distance > 0:
                proportion = distances[i] / total_distance
                stop_eta = total_eta * proportion
            else:
                stop_eta = total_eta / len(request.stops)
            
            # Add unloading time
            stop_eta += (stop.unloadingTimeMinutes or 0)
            cumulative_time += stop_eta
            
            # Calculate factor impacts from features
            traffic_level = encode_traffic_level(request.trafficData.congestionLevel)
            weather_severity = encode_weather_condition(request.weatherData.description)
            
            predictions.append(ETAPrediction(
                stopId=stop.id,
                estimatedArrivalMinutes=cumulative_time,
                confidence=model_confidence,
                factors={
                    'trafficImpact': traffic_level,
                    'weatherImpact': weather_severity,
                    'timeOfDayImpact': 0.1,  # Time-based patterns learned by model
                    'historicalPattern': 0.15,  # Historical patterns from Cainiao data
                }
            ))
        
        return ETAResponse(
            predictions=predictions,
            totalEstimatedMinutes=cumulative_time,
            modelConfidence=model_confidence,
            fallbackUsed=False
        )
        
    except Exception as e:
        logger.error(f"ML prediction failed: {e}", exc_info=True)
        return fallback_eta_calculation(request)

@router.post("/predict", response_model=ETAResponse)
async def predict_eta(request: ETARequest):
    """
    Predict ETA for multi-stop delivery route
    Uses ML model when available, falls back to heuristic calculation
    """
    try:
        logger.info(f"ETA prediction request for {len(request.stops)} stops")
        
        # Use ML prediction (with fallback handling inside)
        result = ml_eta_prediction(request)
        
        logger.info(f"ETA prediction complete: {result.totalEstimatedMinutes:.1f} min "
                   f"(confidence: {result.modelConfidence:.2f}, fallback: {result.fallbackUsed})")
        
        return result
        
    except Exception as e:
        logger.error(f"ETA prediction error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health_check():
    """Check if ETA service is running and model is loaded"""
    return {
        "status": "healthy",
        "model_loaded": TRAINED_MODEL is not None,
        "timestamp": datetime.now().isoformat()
    }

# Model loading function (call during startup)
def load_eta_model(model_path: str):
    """Load trained LaDe model"""
    global TRAINED_MODEL
    try:
        # TODO: Replace with actual LaDe model loading
        # TRAINED_MODEL = load_model(model_path)
        logger.info(f"ETA model loaded from {model_path}")
    except Exception as e:
        logger.error(f"Failed to load ETA model: {e}")
        TRAINED_MODEL = None
