# ML Backend Quick Start

## 🚀 Installation

```bash
cd ml-backend
pip install -r requirements.txt
```

## 📊 Download Cainiao Dataset

```bash
python data_preprocessing.py
```

This will:
- Download Cainiao-AI/LaDe dataset from Hugging Face
- Process trajectory data
- Extract features for training
- Save processed data to `data/processed_cainiao.pkl`

## 🏃 Run Backend Server

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Access:
- API Docs: http://localhost:8000/docs
- Health Check: http://localhost:8000/health
- ETA Prediction: http://localhost:8000/api/eta/predict
- Rerouting: http://localhost:8000/api/reroute

## 🔧 Configure Frontend

Add to `.env.local` in your frontend directory:

```
VITE_ML_BACKEND_URL=http://localhost:8000
```

## 🧪 Test Endpoints

### Test ETA Prediction

```bash
curl -X POST http://localhost:8000/api/eta/predict \
  -H "Content-Type: application/json" \
  -d '{
    "currentLocation": {"lat": 40.7128, "lng": -74.0060},
    "stops": [
      {"id": "stop1", "name": "Stop 1", "location": {"lat": 40.7580, "lng": -73.9855}}
    ],
    "currentSpeed": 45.0,
    "trafficData": {"congestionLevel": "moderate"},
    "weatherData": {"description": "Clear"},
    "timeOfDay": "14:30",
    "dayOfWeek": "Monday"
  }'
```

### Test Rerouting

```bash
curl -X POST http://localhost:8000/api/reroute \
  -H "Content-Type: application/json" \
  -d '{
    "currentLocation": {"lat": 40.7128, "lng": -74.0060},
    "remainingStops": [
      {"id": "stop1", "name": "Stop 1", "location": {"lat": 40.7580, "lng": -73.9855}},
      {"id": "stop2", "name": "Stop 2", "location": {"lat": 40.7489, "lng": -73.9680}}
    ],
    "currentTraffic": {"congestionLevel": "heavy"},
    "currentWeather": {"description": "Rain"},
    "timeOfDay": "08:30",
    "dayOfWeek": "Monday"
  }'
```

## 📝 Notes

- Backend works immediately with fallback heuristics
- ML models can be added later without changing API
- See `HYBRID_SYSTEM_ARCHITECTURE.md` for full architecture details
