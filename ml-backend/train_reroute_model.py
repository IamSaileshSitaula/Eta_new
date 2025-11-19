"""
Route Optimization Model Training Script
Trains a GNN-based model for intelligent rerouting
Optimized for RTX 4060 GPU
"""

import argparse
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
import numpy as np
import pickle
from pathlib import Path
import json

device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"🖥️  Using device: {device}")


class RerouteDataset(Dataset):
    """Dataset for route optimization"""
    
    def __init__(self, pickle_path):
        with open(pickle_path, 'rb') as f:
            self.data = pickle.load(f)
    
    def __len__(self):
        return len(self.data)
    
    def __getitem__(self, idx):
        scenario = self.data[idx]
        
        # Extract features
        stops = scenario['stops']
        current = scenario['current_location']
        traffic_zones = scenario['heavy_traffic_zones']
        optimal_sequence = scenario['optimal_sequence']
        
        # Create node features (stops + current location)
        num_stops = len(stops)
        node_features = np.zeros((num_stops + 1, 5), dtype=np.float32)
        
        # Current location (node 0)
        node_features[0, 0] = current['x']
        node_features[0, 1] = current['y']
        
        # Stops (nodes 1 to num_stops)
        for i, stop in enumerate(stops):
            node_features[i+1, 0] = stop['x']
            node_features[i+1, 1] = stop['y']
            node_features[i+1, 2] = 1 if stop['priority'] == 'high' else 0
            node_features[i+1, 3] = stop['unloading_minutes'] / 15.0  # Normalize
            
            # Traffic score (distance to nearest heavy traffic zone)
            min_traffic_dist = float('inf')
            for zone in traffic_zones:
                dist = np.sqrt((stop['x'] - zone['x'])**2 + (stop['y'] - zone['y'])**2)
                if dist < min_traffic_dist:
                    min_traffic_dist = dist
            
            traffic_score = 1.0 if min_traffic_dist < 2 else 0.0
            node_features[i+1, 4] = traffic_score
        
        # Create adjacency matrix (fully connected)
        num_nodes = num_stops + 1
        edge_index = []
        edge_attr = []
        
        for i in range(num_nodes):
            for j in range(num_nodes):
                if i != j:
                    edge_index.append([i, j])
                    
                    # Edge features: distance, traffic penalty
                    dist = np.sqrt(
                        (node_features[i, 0] - node_features[j, 0])**2 +
                        (node_features[i, 1] - node_features[j, 1])**2
                    )
                    
                    # Check if edge passes through heavy traffic
                    mid_x = (node_features[i, 0] + node_features[j, 0]) / 2
                    mid_y = (node_features[i, 1] + node_features[j, 1]) / 2
                    
                    traffic_penalty = 0.0
                    for zone in traffic_zones:
                        zone_dist = np.sqrt((mid_x - zone['x'])**2 + (mid_y - zone['y'])**2)
                        if zone_dist < zone['radius']:
                            traffic_penalty = 0.5
                            break
                    
                    edge_attr.append([dist, traffic_penalty])
        
        # Convert optimal sequence to node indices (add 1 because node 0 is current location)
        target_sequence = []
        for stop_id in optimal_sequence:
            stop_idx = int(stop_id.split('_')[1])
            target_sequence.append(stop_idx + 1)
        
        return {
            'node_features': torch.tensor(node_features, dtype=torch.float32),
            'edge_index': torch.tensor(edge_index, dtype=torch.long).t(),
            'edge_attr': torch.tensor(edge_attr, dtype=torch.float32),
            'target_sequence': torch.tensor(target_sequence, dtype=torch.long),
            'num_stops': num_stops,
        }


class RouteOptimizationModel(nn.Module):
    """Graph Neural Network for route optimization"""
    
    def __init__(self, node_dim=5, edge_dim=2, hidden_dim=128):
        super(RouteOptimizationModel, self).__init__()
        
        # Node and edge encoders
        self.node_encoder = nn.Sequential(
            nn.Linear(node_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim)
        )
        
        self.edge_encoder = nn.Sequential(
            nn.Linear(edge_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim)
        )
        
        # Graph attention layers
        self.gat1 = GraphAttentionLayer(hidden_dim, hidden_dim)
        self.gat2 = GraphAttentionLayer(hidden_dim, hidden_dim)
        self.gat3 = GraphAttentionLayer(hidden_dim, hidden_dim)
        
        # Pointer network for sequence prediction
        self.pointer_query = nn.Linear(hidden_dim, hidden_dim)
        self.pointer_key = nn.Linear(hidden_dim, hidden_dim)
        
    def forward(self, node_features, edge_index, edge_attr):
        # Encode nodes and edges
        node_embed = self.node_encoder(node_features)  # (num_nodes, hidden_dim)
        
        # Apply graph attention layers
        node_embed = self.gat1(node_embed, edge_index)
        node_embed = self.gat2(node_embed, edge_index)
        node_embed = self.gat3(node_embed, edge_index)
        
        # Compute attention scores for ordering
        query = self.pointer_query(node_embed[0:1])  # Start from current location
        keys = self.pointer_key(node_embed[1:])  # All stops
        
        scores = torch.matmul(query, keys.transpose(0, 1)) / np.sqrt(query.size(-1))
        
        return scores, node_embed


class GraphAttentionLayer(nn.Module):
    """Graph Attention Layer"""
    
    def __init__(self, in_dim, out_dim):
        super(GraphAttentionLayer, self).__init__()
        
        self.linear = nn.Linear(in_dim, out_dim)
        self.attention = nn.Linear(2 * out_dim, 1)
        self.leaky_relu = nn.LeakyReLU(0.2)
        
    def forward(self, x, edge_index):
        # Transform features
        x_transformed = self.linear(x)
        
        # Compute attention coefficients
        num_nodes = x.size(0)
        attention_input = []
        
        for i in range(num_nodes):
            for j in range(num_nodes):
                if i != j:
                    pair = torch.cat([x_transformed[i], x_transformed[j]])
                    attention_input.append(pair)
        
        if attention_input:
            attention_input = torch.stack(attention_input)
            attention_scores = self.leaky_relu(self.attention(attention_input))
            attention_scores = torch.softmax(attention_scores.view(num_nodes, num_nodes-1), dim=1)
            
            # Aggregate
            output = []
            for i in range(num_nodes):
                neighbors = [j for j in range(num_nodes) if j != i]
                neighbor_features = x_transformed[neighbors]
                weights = attention_scores[i].unsqueeze(1)
                aggregated = (neighbor_features * weights).sum(dim=0)
                output.append(x_transformed[i] + aggregated)
            
            output = torch.stack(output)
        else:
            output = x_transformed
        
        return torch.relu(output)


def collate_fn(batch):
    """Custom collate function for variable-sized graphs"""
    return batch


def train_epoch(model, dataloader, optimizer, criterion):
    """Train for one epoch"""
    model.train()
    total_loss = 0
    total_accuracy = 0
    num_samples = 0
    
    for batch in dataloader:
        optimizer.zero_grad()
        batch_loss = 0
        batch_accuracy = 0
        
        for sample in batch:
            node_features = sample['node_features'].to(device)
            edge_index = sample['edge_index'].to(device)
            edge_attr = sample['edge_attr'].to(device)
            target_sequence = sample['target_sequence'].to(device)
            num_stops = sample['num_stops']
            
            # Forward pass
            scores, node_embed = model(node_features, edge_index, edge_attr)
            
            # Loss: predict first stop in optimal sequence
            target_first = target_sequence[0] - 1  # Adjust for 0-indexing of stops
            loss = criterion(scores.squeeze(), target_first)
            
            # Accuracy: is predicted first stop correct?
            predicted_first = scores.argmax(dim=1).item()
            accuracy = 1.0 if predicted_first == target_first.item() else 0.0
            
            batch_loss += loss
            batch_accuracy += accuracy
        
        # Backward pass
        avg_batch_loss = batch_loss / len(batch)
        avg_batch_loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()
        
        total_loss += avg_batch_loss.item()
        total_accuracy += batch_accuracy / len(batch)
        num_samples += 1
    
    return total_loss / num_samples, total_accuracy / num_samples


def validate(model, dataloader, criterion):
    """Validate model"""
    model.eval()
    total_loss = 0
    total_accuracy = 0
    num_samples = 0
    
    with torch.no_grad():
        for batch in dataloader:
            batch_loss = 0
            batch_accuracy = 0
            
            for sample in batch:
                node_features = sample['node_features'].to(device)
                edge_index = sample['edge_index'].to(device)
                edge_attr = sample['edge_attr'].to(device)
                target_sequence = sample['target_sequence'].to(device)
                
                # Forward pass
                scores, node_embed = model(node_features, edge_index, edge_attr)
                
                # Loss and accuracy
                target_first = target_sequence[0] - 1
                loss = criterion(scores.squeeze(), target_first)
                
                predicted_first = scores.argmax(dim=1).item()
                accuracy = 1.0 if predicted_first == target_first.item() else 0.0
                
                batch_loss += loss.item()
                batch_accuracy += accuracy
            
            total_loss += batch_loss / len(batch)
            total_accuracy += batch_accuracy / len(batch)
            num_samples += 1
    
    return total_loss / num_samples, total_accuracy / num_samples


def main(args):
    print("🚀 Starting Route Optimization Model Training")
    print(f"   Epochs: {args.epochs}")
    print(f"   Batch size: {args.batch_size}")
    
    # Load dataset
    print("\n📊 Loading dataset...")
    data_path = Path("data/reroute_training_data.pkl")
    
    if not data_path.exists():
        print("❌ Training data not found!")
        print("   Please run: python prepare_training_data.py")
        return
    
    full_dataset = RerouteDataset(data_path)
    
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
        collate_fn=collate_fn
    )
    
    val_loader = DataLoader(
        val_dataset,
        batch_size=args.batch_size,
        shuffle=False,
        collate_fn=collate_fn
    )
    
    # Create model
    print("\n🧠 Creating model...")
    model = RouteOptimizationModel().to(device)
    
    num_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"   Model parameters: {num_params:,}")
    
    # Optimizer and criterion
    optimizer = optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    criterion = nn.CrossEntropyLoss()
    
    # Training loop
    print("\n🏋️  Training...")
    best_val_loss = float('inf')
    best_accuracy = 0
    
    history = {
        'train_loss': [],
        'val_loss': [],
        'train_accuracy': [],
        'val_accuracy': []
    }
    
    for epoch in range(args.epochs):
        # Train
        train_loss, train_acc = train_epoch(model, train_loader, optimizer, criterion)
        
        # Validate
        val_loss, val_acc = validate(model, val_loader, criterion)
        
        # Update scheduler
        scheduler.step()
        
        # Save history
        history['train_loss'].append(train_loss)
        history['val_loss'].append(val_loss)
        history['train_accuracy'].append(train_acc)
        history['val_accuracy'].append(val_acc)
        
        # Print progress
        print(f"\nEpoch {epoch+1}/{args.epochs}")
        print(f"  Train Loss: {train_loss:.4f}, Train Accuracy: {train_acc*100:.1f}%")
        print(f"  Val Loss: {val_loss:.4f}, Val Accuracy: {val_acc*100:.1f}%")
        
        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_loss': val_loss,
                'val_accuracy': val_acc,
            }, 'models/reroute_model_best.pth')
            print("  ✅ Saved best model (lowest loss)")
        
        if val_acc > best_accuracy:
            best_accuracy = val_acc
            torch.save({
                'epoch': epoch,
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
                'val_loss': val_loss,
                'val_accuracy': val_acc,
            }, 'models/reroute_model_best_acc.pth')
            print("  ✅ Saved best model (highest accuracy)")
    
    # Save final model
    torch.save({
        'epoch': args.epochs,
        'model_state_dict': model.state_dict(),
        'history': history,
    }, 'models/reroute_model_final.pth')
    
    # Save training history
    with open('models/reroute_training_history.json', 'w') as f:
        json.dump(history, f, indent=2)
    
    print("\n✅ Training complete!")
    print(f"   Best validation loss: {best_val_loss:.4f}")
    print(f"   Best accuracy: {best_accuracy*100:.1f}%")
    print("\n🎉 All models trained! Ready to start backend!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--epochs', type=int, default=30, help='Number of epochs')
    parser.add_argument('--batch-size', type=int, default=16, help='Batch size')
    parser.add_argument('--lr', type=float, default=0.001, help='Learning rate')
    parser.add_argument('--gpu', action='store_true', help='Use GPU')
    
    args = parser.parse_args()
    
    main(args)
