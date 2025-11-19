"""
Data preprocessing for Cainiao-AI/LaDe dataset
Prepares trajectory data for route optimization and ETA prediction
"""

from datasets import load_dataset, Dataset
from typing import List, Dict, Tuple
import numpy as np
import pandas as pd
from datetime import datetime
import pickle
import os

class CainiaoDataProcessor:
    """Process Cainiao-AI/LaDe dataset for logistics optimization"""
    
    def __init__(self, dataset_path: str = None):
        """
        Args:
            dataset_path: Path to saved dataset, or None to download from HuggingFace
        """
        if dataset_path and os.path.exists(dataset_path):
            print(f"Loading dataset from {dataset_path}")
            self.dataset = Dataset.load_from_disk(dataset_path)
        else:
            print("Downloading Cainiao-AI/LaDe dataset from HuggingFace...")
            self.dataset = load_dataset('Cainiao-AI/LaDe', split='train')
            
        print(f"Loaded {len(self.dataset)} trajectory samples")
        
    def extract_route_features(self, sample: Dict) -> Dict:
        """
        Extract features from a trajectory sample for route optimization
        
        Returns:
            Dictionary with normalized features for ML model
        """
        features = {
            # Spatial features
            'num_stops': sample.get('num_stops', 0),
            'total_distance_km': sample.get('distance_km', 0),
            'avg_segment_length': sample.get('distance_km', 0) / max(sample.get('num_stops', 1), 1),
            
            # Temporal features
            'time_of_day_encoded': self._encode_time_of_day(sample.get('time_of_day', 'afternoon')),
            'day_of_week': sample.get('day_of_week', 1) / 7.0,  # Normalize to 0-1
            
            # Traffic features
            'avg_traffic_speed_ratio': np.mean(sample.get('traffic_conditions', [1.0])),
            'min_traffic_speed_ratio': np.min(sample.get('traffic_conditions', [1.0])),
            'traffic_variance': np.var(sample.get('traffic_conditions', [1.0])),
            
            # Weather features
            'weather_encoded': self._encode_weather(sample.get('weather', 'clear')),
            
            # Route complexity
            'trajectory_points': len(sample.get('coordinates', [])),
            'road_segments': len(sample.get('road_segments', [])),
            'segments_per_km': len(sample.get('road_segments', [])) / max(sample.get('distance_km', 1), 0.1),
            
            # Target
            'actual_eta_minutes': sample.get('eta_seconds', 0) / 60.0,
            'speed_kmh': sample.get('distance_km', 0) / max(sample.get('eta_seconds', 1), 1) * 3600,
        }
        
        return features
    
    def _encode_time_of_day(self, time_str: str) -> Tuple[float, float]:
        """Encode time of day as sin/cos for cyclical feature"""
        time_map = {
            'morning': 8,    # 8 AM
            'afternoon': 14, # 2 PM
            'evening': 18,   # 6 PM
            'night': 22      # 10 PM
        }
        hour = time_map.get(time_str.lower(), 12)
        
        # Cyclical encoding
        sin_time = np.sin(2 * np.pi * hour / 24)
        cos_time = np.cos(2 * np.pi * hour / 24)
        
        return (sin_time, cos_time)
    
    def _encode_weather(self, weather: str) -> float:
        """Encode weather as numerical value"""
        weather_map = {
            'clear': 0.0,
            'cloudy': 0.3,
            'rain': 0.6,
            'storm': 1.0,
            'snow': 0.8
        }
        return weather_map.get(weather.lower(), 0.0)
    
    def build_training_dataset(self, output_path: str = 'data/processed_cainiao.pkl'):
        """
        Build processed dataset for training LaDe models
        
        Saves:
            - Feature matrix (X)
            - Target ETAs (y)
            - Metadata for each sample
        """
        print("Processing dataset for training...")
        
        X_features = []
        y_targets = []
        metadata = []
        
        for i, sample in enumerate(self.dataset):
            if i % 1000 == 0:
                print(f"Processed {i}/{len(self.dataset)} samples...")
            
            features = self.extract_route_features(sample)
            
            # Create feature vector
            feature_vec = [
                features['num_stops'],
                features['total_distance_km'],
                features['avg_segment_length'],
                features['time_of_day_encoded'][0],
                features['time_of_day_encoded'][1],
                features['day_of_week'],
                features['avg_traffic_speed_ratio'],
                features['min_traffic_speed_ratio'],
                features['traffic_variance'],
                features['weather_encoded'],
                features['trajectory_points'],
                features['road_segments'],
                features['segments_per_km'],
            ]
            
            X_features.append(feature_vec)
            y_targets.append(features['actual_eta_minutes'])
            
            metadata.append({
                'trajectory_id': sample.get('trajectory_id', f'TRJ_{i}'),
                'coordinates': sample.get('coordinates', []),
                'stop_sequence': sample.get('stop_sequence', []),
                'stop_coordinates': sample.get('stop_coordinates', []),
            })
        
        X = np.array(X_features)
        y = np.array(y_targets)
        
        print(f"\nDataset shape: {X.shape}")
        print(f"ETA range: {y.min():.1f} - {y.max():.1f} minutes")
        print(f"Mean ETA: {y.mean():.1f} minutes")
        
        # Save processed data
        os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
        with open(output_path, 'wb') as f:
            pickle.dump({
                'X': X,
                'y': y,
                'metadata': metadata,
                'feature_names': [
                    'num_stops', 'total_distance_km', 'avg_segment_length',
                    'time_sin', 'time_cos', 'day_of_week',
                    'avg_traffic', 'min_traffic', 'traffic_variance',
                    'weather', 'trajectory_points', 'road_segments', 'segments_per_km'
                ]
            }, f)
        
        print(f"Saved processed dataset to {output_path}")
        
        return X, y, metadata
    
    def extract_stop_sequence_patterns(self):
        """
        Analyze common stop sequence patterns from the dataset
        Useful for learning optimal delivery routes
        """
        print("Analyzing stop sequence patterns...")
        
        sequence_stats = {
            'avg_stops_per_route': [],
            'common_sequences': {},
            'distance_per_stop': [],
            'time_per_stop': []
        }
        
        for sample in self.dataset:
            num_stops = sample.get('num_stops', 0)
            if num_stops == 0:
                continue
                
            sequence_stats['avg_stops_per_route'].append(num_stops)
            sequence_stats['distance_per_stop'].append(
                sample.get('distance_km', 0) / num_stops
            )
            sequence_stats['time_per_stop'].append(
                sample.get('eta_seconds', 0) / 60.0 / num_stops
            )
        
        print(f"\nStop Sequence Statistics:")
        print(f"  Average stops per route: {np.mean(sequence_stats['avg_stops_per_route']):.2f}")
        print(f"  Average distance per stop: {np.mean(sequence_stats['distance_per_stop']):.2f} km")
        print(f"  Average time per stop: {np.mean(sequence_stats['time_per_stop']):.2f} minutes")
        
        return sequence_stats
    
    def get_traffic_impact_analysis(self):
        """
        Analyze how traffic conditions impact delivery time
        """
        print("Analyzing traffic impact on delivery times...")
        
        traffic_impact = {
            'low_traffic': [],    # speed ratio > 0.8
            'medium_traffic': [], # 0.5 < speed ratio <= 0.8
            'high_traffic': []    # speed ratio <= 0.5
        }
        
        for sample in self.dataset:
            avg_traffic = np.mean(sample.get('traffic_conditions', [1.0]))
            eta_minutes = sample.get('eta_seconds', 0) / 60.0
            distance = sample.get('distance_km', 0)
            
            if distance == 0:
                continue
            
            speed_kmh = (distance / eta_minutes) * 60 if eta_minutes > 0 else 0
            
            if avg_traffic > 0.8:
                traffic_impact['low_traffic'].append(speed_kmh)
            elif avg_traffic > 0.5:
                traffic_impact['medium_traffic'].append(speed_kmh)
            else:
                traffic_impact['high_traffic'].append(speed_kmh)
        
        print("\nTraffic Impact on Average Speed:")
        print(f"  Low traffic (smooth): {np.mean(traffic_impact['low_traffic']):.1f} km/h")
        print(f"  Medium traffic: {np.mean(traffic_impact['medium_traffic']):.1f} km/h")
        print(f"  High traffic (congested): {np.mean(traffic_impact['high_traffic']):.1f} km/h")
        
        return traffic_impact

# Example usage
if __name__ == "__main__":
    # Initialize processor
    processor = CainiaoDataProcessor()
    
    # Build training dataset
    X, y, metadata = processor.build_training_dataset()
    
    # Analyze patterns
    stop_patterns = processor.extract_stop_sequence_patterns()
    traffic_analysis = processor.get_traffic_impact_analysis()
    
    print("\nDataset ready for LaDe model training!")
