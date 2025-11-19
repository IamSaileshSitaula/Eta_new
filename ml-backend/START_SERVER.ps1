# Quick Start - ML Backend Server
# Run this after training is complete

Write-Host "🚀 Starting ML Backend Server" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""

# Navigate to ml-backend
$mlBackendPath = "C:\Users\saile\OneDrive\Desktop\logistics-b2b-delivery-tracking\ml-backend"
Set-Location $mlBackendPath

# Activate virtual environment
Write-Host "📦 Activating virtual environment..." -ForegroundColor Cyan
& .\venv\Scripts\Activate.ps1

# Check if models exist
Write-Host ""
Write-Host "🔍 Checking for trained models..." -ForegroundColor Cyan

$etaModel = Test-Path "models\eta_model_best.pth"
$rerouteModel = Test-Path "models\reroute_model_best.pth"

if ($etaModel) {
    Write-Host "   ✅ ETA model found" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  ETA model not found (will use fallback)" -ForegroundColor Yellow
}

if ($rerouteModel) {
    Write-Host "   ✅ Reroute model found" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Reroute model not found (will use heuristic)" -ForegroundColor Yellow
}

# Start server
Write-Host ""
Write-Host "🌐 Starting FastAPI server on http://localhost:8000" -ForegroundColor Cyan
Write-Host "   API docs: http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host "   Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
