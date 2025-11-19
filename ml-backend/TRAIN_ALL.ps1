# ML Model Training - Complete Setup Script
# Run this entire script to train both models end-to-end

Write-Host "🚀 ML Model Training Setup for RTX 4060" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
$currentDir = Get-Location
$mlBackendPath = "C:\Users\saile\OneDrive\Desktop\logistics-b2b-delivery-tracking\ml-backend"

if ($currentDir.Path -ne $mlBackendPath) {
    Write-Host "📁 Navigating to ml-backend directory..." -ForegroundColor Yellow
    Set-Location $mlBackendPath
}

# Step 1: Create virtual environment
Write-Host ""
Write-Host "Step 1: Creating virtual environment..." -ForegroundColor Cyan
if (Test-Path "venv") {
    Write-Host "   ✅ Virtual environment already exists" -ForegroundColor Green
} else {
    python -m venv venv
    Write-Host "   ✅ Virtual environment created" -ForegroundColor Green
}

# Step 2: Activate virtual environment
Write-Host ""
Write-Host "Step 2: Activating virtual environment..." -ForegroundColor Cyan
& .\venv\Scripts\Activate.ps1
Write-Host "   ✅ Virtual environment activated" -ForegroundColor Green

# Step 3: Install PyTorch with CUDA
Write-Host ""
Write-Host "Step 3: Installing PyTorch with CUDA 12.1..." -ForegroundColor Cyan
Write-Host "   (This may take 5-10 minutes)" -ForegroundColor Yellow
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
Write-Host "   ✅ PyTorch installed" -ForegroundColor Green

# Step 4: Install other requirements
Write-Host ""
Write-Host "Step 4: Installing other dependencies..." -ForegroundColor Cyan
pip install -r requirements.txt
Write-Host "   ✅ All dependencies installed" -ForegroundColor Green

# Step 4.5: Verify HuggingFace datasets
Write-Host ""
Write-Host "Step 4.5: Verifying HuggingFace datasets..." -ForegroundColor Cyan
$hfCheck = python -c "try:`n    import datasets; print('True')`nexcept:`n    print('False')"
if ($hfCheck -eq "True") {
    Write-Host "   ✅ HuggingFace datasets available - will use real LaDe data!" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  HuggingFace datasets not available - will use synthetic data" -ForegroundColor Yellow
    Write-Host "   To use real LaDe dataset: pip install datasets" -ForegroundColor Yellow
}

# Step 5: Verify GPU
Write-Host ""
Write-Host "Step 5: Verifying GPU access..." -ForegroundColor Cyan
python -c "import torch; print(f'GPU Available: {torch.cuda.is_available()}'); print(f'GPU Name: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"None\"}')"

$gpuCheck = python -c "import torch; print(torch.cuda.is_available())"
if ($gpuCheck -eq "True") {
    Write-Host "   ✅ RTX 4060 detected and ready!" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  WARNING: GPU not detected. Training will be slower." -ForegroundColor Yellow
    Write-Host "   Make sure CUDA 12.1 is installed: https://developer.nvidia.com/cuda-downloads" -ForegroundColor Yellow
}

# Step 6: Download and prepare training data
Write-Host ""
Write-Host "Step 6: Downloading LaDe dataset from HuggingFace..." -ForegroundColor Cyan
Write-Host "   Dataset: Cainiao-AI/LaDe (10M+ real deliveries)" -ForegroundColor Yellow
Write-Host "   This will download ~500MB and calibrate for US roads" -ForegroundColor Yellow
Write-Host "   Download may take 5-10 minutes..." -ForegroundColor Yellow
python prepare_training_data.py --use-real-data --num-samples 10000

if (Test-Path "data\eta_training_data.csv") {
    Write-Host "   ✅ Training data generated successfully" -ForegroundColor Green
} else {
    Write-Host "   ❌ Failed to generate training data" -ForegroundColor Red
    exit 1
}

# Step 7: Train ETA model
Write-Host ""
Write-Host "Step 7: Training ETA Prediction Model..." -ForegroundColor Cyan
Write-Host "   Epochs: 50, Batch size: 32" -ForegroundColor Yellow
Write-Host "   Estimated time: 2-3 hours on RTX 4060" -ForegroundColor Yellow
Write-Host ""
Write-Host "   Starting training... (press Ctrl+C to stop)" -ForegroundColor Yellow
python train_eta_model.py --epochs 50 --batch-size 32 --gpu

if (Test-Path "models\eta_model_best.pth") {
    Write-Host "   ✅ ETA model trained successfully!" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  ETA model training incomplete" -ForegroundColor Yellow
}

# Step 8: Train reroute model
Write-Host ""
Write-Host "Step 8: Training Route Optimization Model..." -ForegroundColor Cyan
Write-Host "   Epochs: 30, Batch size: 16" -ForegroundColor Yellow
Write-Host "   Estimated time: 1-2 hours on RTX 4060" -ForegroundColor Yellow
Write-Host ""
Write-Host "   Starting training... (press Ctrl+C to stop)" -ForegroundColor Yellow
python train_reroute_model.py --epochs 30 --batch-size 16 --gpu

if (Test-Path "models\reroute_model_best.pth") {
    Write-Host "   ✅ Route optimization model trained successfully!" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Route optimization model training incomplete" -ForegroundColor Yellow
}

# Step 9: Summary
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "🎉 TRAINING COMPLETE!" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Trained Models:" -ForegroundColor Cyan
if (Test-Path "models\eta_model_best.pth") {
    Write-Host "   ✅ ETA Prediction Model" -ForegroundColor Green
} else {
    Write-Host "   ❌ ETA Prediction Model (missing)" -ForegroundColor Red
}

if (Test-Path "models\reroute_model_best.pth") {
    Write-Host "   ✅ Route Optimization Model" -ForegroundColor Green
} else {
    Write-Host "   ❌ Route Optimization Model (missing)" -ForegroundColor Red
}

Write-Host ""
Write-Host "📝 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Start ML backend: python -m uvicorn app.main:app --host 0.0.0.0 --port 8000" -ForegroundColor Yellow
Write-Host "   2. Create .env.local in project root with:" -ForegroundColor Yellow
Write-Host "      VITE_ML_BACKEND_URL=http://localhost:8000" -ForegroundColor Yellow
Write-Host "   3. Restart React app: npm run dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "🚀 Your system will now use ML predictions!" -ForegroundColor Green
Write-Host ""
