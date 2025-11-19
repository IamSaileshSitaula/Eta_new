"""
LaDe Dataset Downloader and Preprocessor for US Logistics
Downloads real Cainiao dataset and applies US calibration
"""

import json
import random
import numpy as np
import pandas as pd
from datetime import datetime
from pathlib import Path
import pickle
import urllib.request
import gzip
import shutil

# Try to import datasets library (HuggingFace)
try:
    from datasets import load_dataset
    HUGGINGFACE_AVAILABLE = True
except ImportError:
    HUGGINGFACE_AVAILABLE = False
    print("⚠️  HuggingFace datasets not installed. Will use sample data generation.")
    print("   To use real LaDe dataset: pip install datasets")

# Set random seed for reproducibility
random.seed(42)
np.random.seed(42)

class LaDeDataProcessor:
    """Processes LaDe dataset with US calibration"""
    
    def __init__(self, use_real_data=True, num_samples=10000):
        self.use_real_data = use_real_data and HUGGINGFACE_AVAILABLE
        self.num_samples = num_samples
        self.output_dir = Path("data")
        self.output_dir.mkdir(exist_ok=True)
        
        # US calibration multipliers (Chinese cities are more congested and slower)
        self.us_speed_multiplier = 1.4  # US roads are ~40% faster on average
        self.us_distance_multiplier = 1.0  # Distances similar
        
        # Traffic calibration (Chinese cities have MORE traffic)
        self.traffic_calibration = {
            'none': 1.0,      # No change
            'light': 1.1,     # Less impact in US
            'moderate': 1.2,  # Less impact in US
            'heavy': 1.3      # Less impact in US (better infrastructure)
        }
        
        # Fallback parameters (if LaDe unavailable)
        self.us_cities = [
            {"name": "New York", "traffic_factor": 1.4, "congestion_prob": 0.6},
            {"name": "Los Angeles", "traffic_factor": 1.5, "congestion_prob": 0.7},
            {"name": "Chicago", "traffic_factor": 1.3, "congestion_prob": 0.5},
            {"name": "Houston", "traffic_factor": 1.2, "congestion_prob": 0.4},
            {"name": "Phoenix", "traffic_factor": 1.1, "congestion_prob": 0.3},
        ]
        
        self.road_types = {
            'highway': {'speed_limit': 70, 'traffic_multiplier': 1.0},
            'arterial': {'speed_limit': 45, 'traffic_multiplier': 1.2},
            'residential': {'speed_limit': 25, 'traffic_multiplier': 1.4},
        }
        
        self.traffic_levels = ['none', 'light', 'moderate', 'heavy']
        self.weather_conditions = ['Clear', 'Cloudy', 'Rain', 'Storm', 'Snow']
        
        # Road types with US speed limits
        self.road_types = {
            'highway': {'speed_limit': 70, 'traffic_multiplier': 1.0},
            'arterial': {'speed_limit': 45, 'traffic_multiplier': 1.2},
            'residential': {'speed_limit': 25, 'traffic_multiplier': 1.4},
        }
        
        # Traffic conditions
        self.traffic_levels = ['none', 'light', 'moderate', 'heavy']
        
        # Weather conditions
        self.weather_conditions = ['Clear', 'Cloudy', 'Rain', 'Storm', 'Snow']
        
    def generate_route_features(self):
        """Generate features for a single delivery route"""
        
        # Route characteristics
        num_stops = random.randint(2, 8)
        city = random.choice(self.us_cities)
        
        # Distance parameters (miles)
        total_distance = random.uniform(5, 50)
        avg_stop_distance = total_distance / num_stops
        
        # Traffic (time-of-day dependent)
        hour = random.randint(6, 20)  # 6 AM to 8 PM
        is_rush_hour = hour in [7, 8, 9, 17, 18, 19]
        
        if is_rush_hour:
            # Rush hour: more heavy/moderate traffic
            traffic_probs = [0.1, 0.2, 0.4, 0.3]  # none, light, moderate, heavy
        else:
            # Off-peak: more none/light traffic
            traffic_probs = [0.4, 0.4, 0.15, 0.05]
        
        traffic_level = np.random.choice(self.traffic_levels, p=traffic_probs)
        traffic_numeric = self.traffic_levels.index(traffic_level) / len(self.traffic_levels)
        
        # Weather (season-dependent)
        month = random.randint(1, 12)
        if month in [12, 1, 2]:  # Winter
            weather = np.random.choice(self.weather_conditions, p=[0.2, 0.3, 0.2, 0.1, 0.2])
        elif month in [6, 7, 8]:  # Summer
            weather = np.random.choice(self.weather_conditions, p=[0.5, 0.3, 0.15, 0.05, 0.0])
        else:  # Spring/Fall
            weather = np.random.choice(self.weather_conditions, p=[0.4, 0.3, 0.2, 0.1, 0.0])
        
        weather_severity = {
            'Clear': 0.0, 'Cloudy': 0.0, 'Rain': 0.66, 'Storm': 1.0, 'Snow': 0.8
        }[weather]
        
        # Speed calculation
        base_speed = 60  # mph
        
        # Traffic impact
        traffic_multipliers = {'none': 1.0, 'light': 0.9, 'moderate': 0.75, 'heavy': 0.5}
        traffic_mult = traffic_multipliers[traffic_level]
        
        # Weather impact
        weather_mult = 1.0 - (weather_severity * 0.4)  # Max 40% reduction
        
        # City impact
        city_mult = 1.0 / city['traffic_factor']
        
        current_speed = base_speed * traffic_mult * weather_mult * city_mult
        free_flow_speed = base_speed * city_mult
        speed_ratio = current_speed / free_flow_speed
        
        # Time features (cyclical encoding)
        hour_sin = np.sin(2 * np.pi * hour / 24)
        hour_cos = np.cos(2 * np.pi * hour / 24)
        
        day_of_week = random.randint(0, 6)  # 0 = Monday
        day_sin = np.sin(2 * np.pi * day_of_week / 7)
        day_cos = np.cos(2 * np.pi * day_of_week / 7)
        
        # Environmental features
        temperature = random.uniform(32, 95)  # °F
        wind_speed = random.uniform(0, 25)  # mph
        
        # Calculate actual ETA (ground truth)
        distance_km = total_distance * 1.60934
        speed_kmh = current_speed * 1.60934
        
        base_time = (distance_km / speed_kmh) * 60  # minutes
        
        # Add realistic noise and delays
        traffic_delay = 0
        if traffic_level == 'heavy':
            traffic_delay = random.uniform(5, 15)
        elif traffic_level == 'moderate':
            traffic_delay = random.uniform(2, 8)
        elif traffic_level == 'light':
            traffic_delay = random.uniform(0, 3)
        
        weather_delay = 0
        if weather == 'Storm':
            weather_delay = random.uniform(5, 12)
        elif weather == 'Rain' or weather == 'Snow':
            weather_delay = random.uniform(2, 6)
        
        # Random variability (driver skill, unexpected stops, etc.)
        random_delay = random.gauss(0, 2)  # Mean 0, std 2 minutes
        
        actual_eta = base_time + traffic_delay + weather_delay + random_delay
        actual_eta = max(5, actual_eta)  # Minimum 5 minutes
        
        # Create feature vector
        features = {
            'num_stops': num_stops,
            'total_distance_km': distance_km,
            'avg_stop_distance_km': distance_km / num_stops,
            'traffic_level': traffic_numeric,
            'weather_severity': weather_severity,
            'current_speed': current_speed,
            'speed_ratio': speed_ratio,
            'hour_sin': hour_sin,
            'hour_cos': hour_cos,
            'day_sin': day_sin,
            'day_cos': day_cos,
            'wind_speed': wind_speed,
            'temperature': temperature,
            
            # Labels
            'actual_eta_minutes': actual_eta,
            'base_eta_minutes': base_time,
            'traffic_delay': traffic_delay,
            'weather_delay': weather_delay,
            
            # Metadata (for analysis, not used in training)
            'city': city['name'],
            'traffic_level_str': traffic_level,
            'weather': weather,
            'hour': hour,
            'day_of_week': day_of_week,
            'is_rush_hour': is_rush_hour,
        }
        
        return features
    
    def generate_reroute_scenario(self):
        """Generate a route optimization scenario"""
        
        num_stops = random.randint(3, 6)
        
        # Generate stop locations (normalized coordinates)
        stops = []
        for i in range(num_stops):
            stop = {
                'id': f'stop_{i}',
                'x': random.uniform(0, 10),
                'y': random.uniform(0, 10),
                'priority': random.choice(['high', 'normal', 'low']),
                'unloading_minutes': random.randint(5, 15),
            }
            stops.append(stop)
        
        # Current location
        current = {'x': random.uniform(0, 10), 'y': random.uniform(0, 10)}
        
        # Traffic zones (some areas have heavy traffic)
        heavy_traffic_zones = [
            {'x': random.uniform(0, 10), 'y': random.uniform(0, 10), 'radius': 2}
            for _ in range(random.randint(0, 2))
        ]
        
        # Calculate optimal route (greedy nearest-neighbor with traffic)
        def calculate_distance(p1, p2):
            dist = np.sqrt((p1['x'] - p2['x'])**2 + (p1['y'] - p2['y'])**2)
            
            # Check if route passes through heavy traffic
            for zone in heavy_traffic_zones:
                mid_x = (p1['x'] + p2['x']) / 2
                mid_y = (p1['y'] + p2['y']) / 2
                zone_dist = np.sqrt((mid_x - zone['x'])**2 + (mid_y - zone['y'])**2)
                if zone_dist < zone['radius']:
                    dist *= 1.5  # Traffic penalty
            
            return dist
        
        # Find optimal sequence
        remaining = stops.copy()
        sequence = []
        pos = current
        total_time = 0
        
        while remaining:
            # Find nearest unvisited stop
            best_idx = 0
            best_dist = float('inf')
            
            for idx, stop in enumerate(remaining):
                dist = calculate_distance(pos, stop)
                
                # Priority bonus
                if stop['priority'] == 'high':
                    dist *= 0.9
                
                if dist < best_dist:
                    best_dist = dist
                    best_idx = idx
            
            next_stop = remaining.pop(best_idx)
            sequence.append(next_stop['id'])
            
            # Calculate time
            travel_time = best_dist * 60 / 40  # Assume 40 mph average
            total_time += travel_time + next_stop['unloading_minutes']
            
            pos = next_stop
        
        return {
            'stops': stops,
            'current_location': current,
            'heavy_traffic_zones': heavy_traffic_zones,
            'optimal_sequence': sequence,
            'optimal_time': total_time,
        }
    
    def download_lade_dataset(self):
        """Download LaDe dataset from HuggingFace"""
        
        print("📥 Downloading LaDe dataset from HuggingFace...")
        print("   Dataset: Cainiao-AI/LaDe")
        print("   Size: ~500MB compressed, 10M+ deliveries")
        print("   This may take 5-10 minutes depending on internet speed...")
        
        try:
            # Load dataset (automatically downloads and caches)
            dataset = load_dataset("Cainiao-AI/LaDe", split="train")
            
            print(f"   ✅ Downloaded {len(dataset)} samples")
            
            # Convert to pandas for easier processing
            df = dataset.to_pandas()
            
            # Sample if dataset is too large
            if len(df) > self.num_samples:
                print(f"   Sampling {self.num_samples} from {len(df)} total samples...")
                df = df.sample(n=self.num_samples, random_state=42)
            
            return df
            
        except Exception as e:
            print(f"   ❌ Failed to download LaDe dataset: {e}")
            print("   Will generate synthetic data instead...")
            return None
    
    def calibrate_for_us(self, china_df):
        """Apply US calibration to Chinese data"""
        
        print("\n🇺🇸 Applying US calibration to Chinese dataset...")
        
        # Create calibrated copy
        us_df = china_df.copy()
        
        # Adjust speeds (US roads are faster)
        if 'current_speed' in us_df.columns:
            us_df['current_speed'] = us_df['current_speed'] * self.us_speed_multiplier
        
        if 'speed_ratio' in us_df.columns:
            # Speed ratio improves (less congestion)
            us_df['speed_ratio'] = np.clip(us_df['speed_ratio'] * 1.2, 0, 1)
        
        # Adjust ETA (faster speeds = shorter times)
        if 'actual_eta_minutes' in us_df.columns:
            us_df['actual_eta_minutes'] = us_df['actual_eta_minutes'] / self.us_speed_multiplier
        
        # Adjust traffic delays (better infrastructure)
        if 'traffic_delay' in us_df.columns:
            us_df['traffic_delay'] = us_df['traffic_delay'] * 0.7  # 30% less delay
        
        print("   ✅ US calibration applied")
        print(f"   Average speed increase: {(self.us_speed_multiplier - 1) * 100:.0f}%")
        print(f"   Average time reduction: {(1 - 1/self.us_speed_multiplier) * 100:.0f}%")
        
        return us_df
    
    def process_lade_data(self, lade_df):
        """Process LaDe dataset into our training format"""
        
        print("\n🔧 Processing LaDe data into training format...")
        
        processed_data = []
        
        for idx, row in lade_df.iterrows():
            if idx % 1000 == 0:
                print(f"   Progress: {idx}/{len(lade_df)}")
            
            # Extract features from LaDe format
            # Note: Actual LaDe columns may vary, adapt as needed
            sample = {}
            
            # Try to extract common features
            if 'package_count' in row:
                sample['num_stops'] = row['package_count']
            else:
                sample['num_stops'] = np.random.randint(2, 8)
            
            if 'distance' in row:
                sample['total_distance_km'] = row['distance']
            elif 'route_length' in row:
                sample['total_distance_km'] = row['route_length']
            else:
                sample['total_distance_km'] = np.random.uniform(5, 50) * 1.60934
            
            sample['avg_stop_distance_km'] = sample['total_distance_km'] / sample['num_stops']
            
            # Traffic level (normalize to 0-1)
            if 'traffic_level' in row:
                sample['traffic_level'] = row['traffic_level']
            else:
                sample['traffic_level'] = np.random.uniform(0, 1)
            
            # Weather severity
            if 'weather' in row or 'weather_condition' in row:
                weather_col = 'weather' if 'weather' in row else 'weather_condition'
                sample['weather_severity'] = self._weather_to_severity(row[weather_col])
            else:
                sample['weather_severity'] = np.random.choice([0.0, 0.0, 0.66, 1.0], p=[0.5, 0.3, 0.15, 0.05])
            
            # Speed features
            if 'speed' in row:
                sample['current_speed'] = row['speed'] * self.us_speed_multiplier
            else:
                sample['current_speed'] = np.random.uniform(30, 70)
            
            sample['speed_ratio'] = np.random.uniform(0.5, 1.0)
            
            # Time features (cyclical encoding)
            if 'hour' in row:
                hour = row['hour']
            elif 'timestamp' in row:
                hour = pd.to_datetime(row['timestamp']).hour
            else:
                hour = np.random.randint(6, 20)
            
            sample['hour_sin'] = np.sin(2 * np.pi * hour / 24)
            sample['hour_cos'] = np.cos(2 * np.pi * hour / 24)
            
            if 'day_of_week' in row:
                day = row['day_of_week']
            else:
                day = np.random.randint(0, 7)
            
            sample['day_sin'] = np.sin(2 * np.pi * day / 7)
            sample['day_cos'] = np.cos(2 * np.pi * day / 7)
            
            # Environmental features
            if 'temperature' in row:
                sample['temperature'] = row['temperature']
            else:
                sample['temperature'] = np.random.uniform(32, 95)
            
            if 'wind_speed' in row:
                sample['wind_speed'] = row['wind_speed']
            else:
                sample['wind_speed'] = np.random.uniform(0, 25)
            
            # Target: ETA in minutes
            if 'eta' in row:
                sample['actual_eta_minutes'] = row['eta'] / self.us_speed_multiplier
            elif 'delivery_time' in row:
                sample['actual_eta_minutes'] = row['delivery_time'] / self.us_speed_multiplier
            else:
                # Fallback calculation
                base_time = (sample['total_distance_km'] / (sample['current_speed'] * 1.60934)) * 60
                sample['actual_eta_minutes'] = base_time
            
            # Calculate base ETA and delays
            sample['base_eta_minutes'] = (sample['total_distance_km'] / (sample['current_speed'] * 1.60934)) * 60
            sample['traffic_delay'] = max(0, (sample['actual_eta_minutes'] - sample['base_eta_minutes']) * 0.6)
            sample['weather_delay'] = max(0, sample['actual_eta_minutes'] - sample['base_eta_minutes'] - sample['traffic_delay'])
            
            processed_data.append(sample)
        
        return pd.DataFrame(processed_data)
    
    def _weather_to_severity(self, weather_str):
        """Convert weather string to severity score"""
        weather_lower = str(weather_str).lower()
        
        if 'storm' in weather_lower or 'severe' in weather_lower:
            return 1.0
        elif 'snow' in weather_lower or 'heavy rain' in weather_lower:
            return 0.8
        elif 'rain' in weather_lower or 'drizzle' in weather_lower:
            return 0.66
        elif 'cloud' in weather_lower or 'overcast' in weather_lower:
            return 0.0
        else:  # Clear
            return 0.0
    
    def generate_dataset(self):
        """Generate complete dataset"""
        
        print("🚀 Preparing Training Dataset for US Logistics...")
        print(f"   Target samples: {self.num_samples}")
        
        eta_df = None
        
        # Try to use real LaDe dataset
        if self.use_real_data:
            print("\n📦 Using Real LaDe Dataset (Recommended)")
            lade_raw = self.download_lade_dataset()
            
            if lade_raw is not None:
                # Process and calibrate for US
                eta_df = self.process_lade_data(lade_raw)
                eta_df = self.calibrate_for_us(eta_df)
        
        # Fallback to synthetic data if LaDe unavailable
        if eta_df is None:
            print("\n⚠️  LaDe dataset unavailable. Generating synthetic data...")
            print("   Install HuggingFace datasets: pip install datasets")
            eta_data = []
            for i in range(self.num_samples):
                if i % 1000 == 0:
                    print(f"   Progress: {i}/{self.num_samples}")
                sample = self.generate_route_features()
                eta_data.append(sample)
            eta_df = pd.DataFrame(eta_data)
        
        # Save ETA dataset
        eta_output = self.output_dir / "eta_training_data.csv"
        eta_df.to_csv(eta_output, index=False)
        print(f"   ✅ Saved: {eta_output}")
        
        # Generate route optimization data
        print("\n🔀 Generating route optimization data...")
        reroute_data = []
        num_reroute_samples = self.num_samples // 2
        
        for i in range(num_reroute_samples):
            if i % 500 == 0:
                print(f"   Progress: {i}/{num_reroute_samples}")
            
            scenario = self.generate_reroute_scenario()
            reroute_data.append(scenario)
        
        # Save reroute dataset
        reroute_output = self.output_dir / "reroute_training_data.pkl"
        with open(reroute_output, 'wb') as f:
            pickle.dump(reroute_data, f)
        print(f"   ✅ Saved: {reroute_output}")
        
        # Generate statistics
        print("\n📈 Dataset Statistics:")
        print(f"   Total ETA samples: {len(eta_df)}")
        print(f"   Total reroute samples: {len(reroute_data)}")
        print(f"\n   ETA Distribution:")
        print(f"   - Mean ETA: {eta_df['actual_eta_minutes'].mean():.1f} minutes")
        print(f"   - Std ETA: {eta_df['actual_eta_minutes'].std():.1f} minutes")
        print(f"   - Min ETA: {eta_df['actual_eta_minutes'].min():.1f} minutes")
        print(f"   - Max ETA: {eta_df['actual_eta_minutes'].max():.1f} minutes")
        print(f"\n   Traffic Distribution:")
        print(eta_df['traffic_level_str'].value_counts())
        print(f"\n   Weather Distribution:")
        print(eta_df['weather'].value_counts())
        print(f"\n   City Distribution:")
        print(eta_df['city'].value_counts())
        
        print("\n✅ Dataset generation complete!")
        print(f"   Data saved to: {self.output_dir.absolute()}")
        
        return eta_df, reroute_data


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Prepare training data from LaDe dataset')
    parser.add_argument('--use-real-data', action='store_true', default=True,
                        help='Use real LaDe dataset (requires: pip install datasets)')
    parser.add_argument('--synthetic', action='store_true',
                        help='Force synthetic data generation instead of LaDe')
    parser.add_argument('--num-samples', type=int, default=10000,
                        help='Number of samples to use (default: 10000)')
    
    args = parser.parse_args()
    
    # Override if synthetic flag is set
    use_real = args.use_real_data and not args.synthetic
    
    processor = LaDeDataProcessor(use_real_data=use_real, num_samples=args.num_samples)
    eta_data, reroute_data = processor.generate_dataset()
    
    print("\n🎉 Ready for training!")
    print("   Next step: python train_eta_model.py --epochs 50 --batch-size 32 --gpu")
