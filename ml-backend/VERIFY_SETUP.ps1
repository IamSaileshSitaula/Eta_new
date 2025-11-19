# Verify Setup and Download LaDe Dataset
# Quick check before training

Write-Host "🔍 Verifying ML Training Setup" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host ""

# Navigate to ml-backend
$mlBackendPath = "C:\Users\saile\OneDrive\Desktop\logistics-b2b-delivery-tracking\ml-backend"
Set-Location $mlBackendPath

# Check if virtual environment exists
if (Test-Path "venv") {
    Write-Host "✅ Virtual environment found" -ForegroundColor Green
    & .\venv\Scripts\Activate.ps1
} else {
    Write-Host "❌ Virtual environment not found" -ForegroundColor Red
    Write-Host "   Run: python -m venv venv" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "📦 Checking Python packages..." -ForegroundColor Cyan

# Check PyTorch
Write-Host -NoNewline "   PyTorch: "
$torchCheck = python -c "try:`n    import torch; print('True')`nexcept:`n    print('False')"
if ($torchCheck -eq "True") {
    Write-Host "✅" -ForegroundColor Green
    
    # Check CUDA
    $cudaCheck = python -c "import torch; print(torch.cuda.is_available())"
    if ($cudaCheck -eq "True") {
        $gpuName = python -c "import torch; print(torch.cuda.get_device_name(0))"
        Write-Host "   GPU: ✅ $gpuName" -ForegroundColor Green
    } else {
        Write-Host "   GPU: ⚠️  CUDA not available (training will be slower)" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌" -ForegroundColor Red
    Write-Host "   Install: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121" -ForegroundColor Yellow
}

# Check HuggingFace datasets
Write-Host -NoNewline "   HuggingFace datasets: "
$hfCheck = python -c "try:`n    import datasets; print('True')`nexcept:`n    print('False')"
if ($hfCheck -eq "True") {
    Write-Host "✅ (will use real LaDe data)" -ForegroundColor Green
} else {
    Write-Host "⚠️  Not installed" -ForegroundColor Yellow
    Write-Host "   Install: pip install datasets huggingface-hub" -ForegroundColor Yellow
    Write-Host "   Without this, will use synthetic data (less accurate)" -ForegroundColor Yellow
}

# Check other dependencies
$packages = @("numpy", "pandas", "fastapi", "uvicorn")
foreach ($pkg in $packages) {
    Write-Host -NoNewline "   $pkg : "
    $check = python -c "try:`n    import $pkg; print('True')`nexcept:`n    print('False')"
    if ($check -eq "True") {
        Write-Host "✅" -ForegroundColor Green
    } else {
        Write-Host "❌" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "📊 Checking existing data..." -ForegroundColor Cyan

if (Test-Path "data\eta_training_data.csv") {
    $fileSize = (Get-Item "data\eta_training_data.csv").Length / 1MB
    Write-Host "   ✅ ETA training data found ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Green
} else {
    Write-Host "   ❌ Training data not found" -ForegroundColor Yellow
}

if (Test-Path "models\eta_model_best.pth") {
    Write-Host "   ✅ ETA model already trained" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  ETA model not trained yet" -ForegroundColor Yellow
}

if (Test-Path "models\reroute_model_best.pth") {
    Write-Host "   ✅ Reroute model already trained" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Reroute model not trained yet" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host ""

# Summary and next steps
$allGood = $torchCheck -eq "True" -and $hfCheck -eq "True"

if ($allGood) {
    Write-Host "🎉 All systems ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📋 Next steps:" -ForegroundColor Cyan
    Write-Host "   1. Download LaDe dataset: python prepare_training_data.py --use-real-data" -ForegroundColor Yellow
    Write-Host "      (This will download ~500MB from HuggingFace, takes 5-10 min)" -ForegroundColor White
    Write-Host ""
    Write-Host "   2. Train models: .\TRAIN_ALL.ps1" -ForegroundColor Yellow
    Write-Host "      (Full training: 3-4 hours on RTX 4060)" -ForegroundColor White
    Write-Host ""
    Write-Host "   OR for quick demo (30 min):" -ForegroundColor Cyan
    Write-Host "      python train_eta_model.py --epochs 10 --batch-size 32 --gpu" -ForegroundColor Yellow
    Write-Host "      python train_reroute_model.py --epochs 10 --batch-size 16 --gpu" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  Some dependencies missing" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "📋 Install missing packages:" -ForegroundColor Cyan
    
    if ($torchCheck -ne "True") {
        Write-Host "   pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121" -ForegroundColor Yellow
    }
    
    if ($hfCheck -ne "True") {
        Write-Host "   pip install datasets huggingface-hub" -ForegroundColor Yellow
    }
    
    Write-Host "   pip install -r requirements.txt" -ForegroundColor Yellow
}

Write-Host ""
