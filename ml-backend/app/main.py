"""
FastAPI Main Application
Hybrid ETA & ML Rerouting Backend
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import logging

# Import routers
from app.routers import eta, reroute

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title="Logistics ML Backend",
    description="Hybrid ETA prediction and ML-based rerouting using LaDe models",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update with your frontend URL in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(eta.router)
app.include_router(reroute.router)

@app.on_event("startup")
async def startup_event():
    """Load ML models on startup"""
    logger.info("🚀 Starting ML Backend...")
    
    # Load trained models
    from pathlib import Path
    base_path = Path(__file__).parent.parent / "models"
    
    # Load ETA model
    eta_model_path = base_path / "eta_model_best.pth"
    if eta_model_path.exists():
        eta.load_eta_model(str(eta_model_path))
        logger.info("✅ ETA model loaded")
    else:
        logger.warning(f"⚠️ ETA model not found at {eta_model_path}")
    
    # Load Reroute GNN model
    reroute_model_path = base_path / "reroute_model_best.pth"
    if reroute_model_path.exists():
        reroute.load_reroute_model(str(reroute_model_path))
        logger.info("✅ Reroute GNN model loaded")
    else:
        logger.warning(f"⚠️ Reroute model not found at {reroute_model_path}")
    
    logger.info("🎉 ML Backend started successfully")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down ML Backend...")

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "Logistics ML Backend",
        "version": "1.0.0",
        "features": {
            "hybrid_eta": True,
            "ml_rerouting": True,
            "tomtom_integration": True,
            "weather_integration": True,
        }
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "eta_service": "operational",
        "reroute_service": "operational",
        "timestamp": "2025-11-16T00:00:00Z"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
