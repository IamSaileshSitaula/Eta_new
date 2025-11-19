"""
ETA Prediction Model Training Script
Trains a transformer-based model on US delivery data
Optimized for RTX 4060 GPU
"""

import argparse
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime
import json

# Set device
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"🖥️  Using device: {device}")
if torch.cuda.is_available():
    print(f"   GPU: {torch.cuda.get_device_name(0)}")
    print(f"   Memory: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")


class ETADataset(Dataset):
    """Dataset for ETA prediction"""
    
    def __init__(self, csv_path):
        self.data = pd.read_csv(csv_path)
        
        # Feature columns (13 features)
        self.feature_cols = [
            'num_stops', 'total_distance_km', 'avg_stop_distance_km',
            'traffic_level', 'weather_severity', 'current_speed', 'speed_ratio',
            'hour_sin', 'hour_cos', 'day_sin', 'day_cos',
            'wind_speed', 'temperature'
        ]
        
        # Normalize features
        self.X = self.data[self.feature_cols].values.astype(np.float32)
        self.X_mean = self.X.mean(axis=0)
        self.X_std = self.X.std(axis=0)
        self.X = (self.X - self.X_mean) / (self.X_std + 1e-8)
        
        # Labels
        self.y = self.data['actual_eta_minutes'].values.astype(np.float32)
        
        # Additional outputs (for analysis)
        self.traffic_delay = self.data['traffic_delay'].values.astype(np.float32)
        self.weather_delay = self.data['weather_delay'].values.astype(np.float32)
        
    def __len__(self):
        return len(self.data)
    
    def __getitem__(self, idx):
        return (
            torch.tensor(self.X[idx]),
            torch.tensor([self.y[idx]]),
            torch.tensor([self.traffic_delay[idx]]),
            torch.tensor([self.weather_delay[idx]])
        )


class ETAPredictionModel(nn.Module):
    """Transformer-based ETA prediction model"""
    
    def __init__(self, input_dim=13, hidden_dim=128, num_layers=4):
        super(ETAPredictionModel, self).__init__()
        
        # Input projection
        self.input_proj = nn.Linear(input_dim, hidden_dim)
        
        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=hidden_dim,
            nhead=8,
            dim_feedforward=512,
            dropout=0.1,
            batch_first=True
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        
        # Output heads
        self.eta_head = nn.Sequential(
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(64, 1)
        )
        
        self.confidence_head = nn.Sequential(
            nn.Linear(hidden_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid()  # Output between 0 and 1
        )
        
        # Auxiliary heads (for better learning)
        self.traffic_head = nn.Linear(hidden_dim, 1)
        self.weather_head = nn.Linear(hidden_dim, 1)
        
    def forward(self, x):
        # Project input
        x = self.input_proj(x)  # (batch, hidden_dim)
        x = x.unsqueeze(1)  # (batch, 1, hidden_dim)
        
        # Transformer
        x = self.transformer(x)  # (batch, 1, hidden_dim)
        x = x.squeeze(1)  # (batch, hidden_dim)
        
        # Predictions
        eta = self.eta_head(x)
        confidence = self.confidence_head(x)
        traffic = self.traffic_head(x)
        weather = self.weather_head(x)
        
        return eta, confidence, traffic, weather


def train_epoch(model, dataloader, optimizer, criterion):
    """Train for one epoch"""
    model.train()
    total_loss = 0
    total_eta_error = 0
    num_batches = 0
    
    for features, eta_target, traffic_target, weather_target in dataloader:
        features = features.to(device)
        eta_target = eta_target.to(device)
        traffic_target = traffic_target.to(device)
        weather_target = weather_target.to(device)
        
        # Forward pass
        eta_pred, confidence, traffic_pred, weather_pred = model(features)
        
        # Multi-task loss
        eta_loss = criterion(eta_pred, eta_target)
        traffic_loss = criterion(traffic_pred, traffic_target)
        weather_loss = criterion(weather_pred, weather_target)
        
        # Combined loss (weighted)
        loss = eta_loss + 0.3 * traffic_loss + 0.3 * weather_loss
        
        # Backward pass
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        
        # Metrics
        total_loss += loss.item()
        total_eta_error += torch.abs(eta_pred - eta_target).mean().item()
        num_batches += 1
    
    return total_loss / num_batches, total_eta_error / num_batches


def validate(model, dataloader, criterion):
    """Validate model"""
    model.eval()
    total_loss = 0
    total_eta_error = 0
    all_predictions = []
    all_targets = []
    all_confidences = []
    num_batches = 0
    
    with torch.no_grad():
        for features, eta_target, traffic_target, weather_target in dataloader:
            features = features.to(device)
            eta_target = eta_target.to(device)
            traffic_target = traffic_target.to(device)
            weather_target = weather_target.to(device)
            
            # Forward pass
            eta_pred, confidence, traffic_pred, weather_pred = model(features)
            
            # Loss
            eta_loss = criterion(eta_pred, eta_target)
            traffic_loss = criterion(traffic_pred, traffic_target)
            weather_loss = criterion(weather_pred, weather_target)
            loss = eta_loss + 0.3 * traffic_loss + 0.3 * weather_loss
            
            # Metrics
            total_loss += loss.item()
            total_eta_error += torch.abs(eta_pred - eta_target).mean().item()
            
            all_predictions.extend(eta_pred.cpu().numpy())
            all_targets.extend(eta_target.cpu().numpy())
            all_confidences.extend(confidence.cpu().numpy())
            num_batches += 1
    
    # Calculate accuracy (within 5 minutes)
    predictions = np.array(all_predictions)
    targets = np.array(all_targets)
    within_5min = np.abs(predictions - targets) <= 5
    accuracy = within_5min.mean()
    
    return total_loss / num_batches, total_eta_error / num_batches, accuracy


def main(args):
    print("🚀 Starting ETA Model Training")
    print(f"   Epochs: {args.epochs}")
    print(f"   Batch size: {args.batch_size}")
    print(f"   Learning rate: {args.lr}")
    
    # Load dataset
    print("\n📊 Loading dataset...")
    data_path = Path("data/eta_training_data.csv")
    
    if not data_path.exists():
        print("❌ Training data not found!")
        print("   Please run: python prepare_training_data.py")
        return
    
    full_dataset = ETADataset(data_path)
    
    # Train/val split
    train_size = int(0.8 * len(full_dataset))
    val_size = len(full_dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(
        full_dataset, [train_size, val_size]
    )
    
    print(f"   Train samples: {train_size}")
    print(f"   Val samples: {val_size}")
    
    # Dataloaders
    train_loader = DataLoader(
        train_dataset,
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=2,
        pin_memory=True if args.gpu else False
    )
    
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=2,
        pin_memory=True if args.gpu else False
    )
    
    # Create model
    print("\n🧠 Creating model...")
    model = ETAPredictionModel().to(device)
    
    # Count parameters
    num_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"   Model parameters: {num_params:,}")
    
    # Optimizer and criterion
    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.SmoothL1Loss()  # Huber loss (robust to outliers)
    
    # Training loop
    print("\n🏋️  Training...")
    best_val_loss = float('inf')
    best_accuracy = 0
    
    history = {
        'train_loss': [],
        'val_loss': [],
        'train_error': [],
        'val_error': [],
        'accuracy': []
    }
    
    for epoch in range(args.epochs):
        # Train
        train_loss, train_error = train_epoch(model, train_loader, optimizer, criterion)
        
        # Validate
        val_loss, val_error, accuracy = validate(model, val_loader, criterion)
        
        # Update scheduler
        scheduler.step()
        
        # Save history
        history['train_loss'].append(train_loss)
        history['val_loss'].append(val_loss)
        history['train_error'].append(train_error)
        history['val_error'].append(val_error)
        history['accuracy'].append(accuracy)
        
        # Print progress
        print(f"\nEpoch {epoch+1}/{args.epochs}")
        print(f"  Train Loss: {train_loss:.4f}, Train Error: {train_error:.2f} min")
        print(f"  Val Loss: {val_loss:.4f}, Val Error: {val_error:.2f} min")
        print(f"  Accuracy (±5min): {accuracy*100:.1f}%")
        
        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_loss': val_loss,
                'val_error': val_error,
                'accuracy': accuracy,
                'X_mean': full_dataset.X_mean,
                'X_std': full_dataset.X_std,
            }, 'models/eta_model_best.pth')
            print("  ✅ Saved best model (lowest loss)")
        
        if accuracy > best_accuracy:
            best_accuracy = accuracy
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_loss': val_loss,
                'val_error': val_error,
                'accuracy': accuracy,
                'X_mean': full_dataset.X_mean,
                'X_std': full_dataset.X_std,
            }, 'models/eta_model_best_acc.pth')
            print("  ✅ Saved best model (highest accuracy)")
        
        # Save checkpoint every 5 epochs
        if (epoch + 1) % 5 == 0:
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
            }, f'models/eta_model_epoch_{epoch+1}.pth')
    
    # Save final model
    torch.save({
        'epoch': args.epochs,
        'model_state_dict': model.state_dict(),
        'optimizer_state_dict': optimizer.state_dict(),
        'history': history,
        'X_mean': full_dataset.X_mean,
        'X_std': full_dataset.X_std,
    }, 'models/eta_model_final.pth')
    
    # Save training history
    with open('models/training_history.json', 'w') as f:
        json.dump(history, f, indent=2)
    
    print("\n✅ Training complete!")
    print(f"   Best validation loss: {best_val_loss:.4f}")
    print(f"   Best accuracy: {best_accuracy*100:.1f}%")
    print(f"   Models saved to: models/")
    print("\n🎉 Next step: python train_reroute_model.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=50, help='Number of epochs')
    parser.add_argument('--batch-size', type=int, default=32, help='Batch size')
    parser.add_argument('--lr', type=float, default=0.001, help='Learning rate')
    parser.add_argument('--gpu', action='store_true', help='Use GPU')
    
    args = parser.parse_args()
    
    # Create models directory
    Path('models').mkdir(exist_ok=True)
    
    main(args)
