# API Setup Guide

This application now uses real-time data from multiple APIs to provide accurate tracking, weather, and traffic information.

## 🔑 Required API Keys (All FREE)

### 1. OpenWeatherMap API (Weather Data)
- **Sign up**: https://openweathermap.org/api
- **Free tier**: 1,000 API calls/day (60/minute)
- **Cost**: $0 (Free forever)

**Steps to get API key:**
1. Visit https://openweathermap.org/api
2. Click "Sign Up" (top right)
3. Create a free account
4. Verify your email
5. Go to API Keys section
6. Copy your API key
7. Add to `.env.local`: `VITE_OPENWEATHER_API_KEY=your_key_here`

**Note**: It may take a few minutes (up to 2 hours) for your API key to activate.

---

### 2. TomTom Traffic API (Traffic Data)
- **Sign up**: https://developer.tomtom.com/
- **Free tier**: 2,500 API calls/day
- **Cost**: $0 (Free forever)

**Steps to get API key:**
1. Visit https://developer.tomtom.com/
2. Click "Get Started for Free"
3. Create a free account
4. Verify your email
5. Create a new project/app
6. Copy your API key from the dashboard
7. Add to `.env.local`: `VITE_TOMTOM_API_KEY=your_key_here`

---

## 📝 Configuration

1. Open `.env.local` file in the project root
2. Replace the placeholder values:

```bash
# Replace these with your actual API keys
VITE_OPENWEATHER_API_KEY=your_openweather_api_key_here
VITE_TOMTOM_API_KEY=your_tomtom_api_key_here
```

3. Save the file
4. Restart your development server: `npm run dev`

---

## 🚀 What Changed

### Dynamic Speed Simulation
- ✅ **No more fixed 50 mph speed** - Speed now varies by road type
- ✅ **Highway**: 65-70 mph (98% of speed limit)
- ✅ **Arterial roads**: 45-55 mph (96% of speed limit)
- ✅ **City streets**: 30-35 mph (92% of speed limit)
- ✅ **Residential**: 25-30 mph (90% of speed limit)

### Weather Impact (Real-time from OpenWeatherMap)
- ✅ **Clear weather**: 100% normal speed
- ✅ **Rain**: 75% speed reduction
- ✅ **Storm/Snow**: 55% speed reduction
- ✅ **Real temperature** in Fahrenheit
- ✅ **Visibility warnings** for fog/mist
- ✅ **Wind warnings** for large vehicles

### Traffic Impact (Real-time from TomTom)
- ✅ **Light traffic**: 95-100% normal speed
- ✅ **Moderate traffic**: 55-70% speed (varies by road type)
- ✅ **Heavy traffic**: 20-35% speed (stop-and-go)
- ✅ **Real current speeds** on actual roads
- ✅ **Delay percentages** shown to users

### Traffic Stop Simulation
- ✅ **Traffic lights**: 20-75 second stops (50% chance at intersections)
- ✅ **Stop signs**: 3-8 second stops (residential areas)
- ✅ **Rush hour**: Increased stop frequency (7-9 AM, 4-7 PM)
- ✅ **Gridlock stops**: 30-150 seconds in heavy traffic

### Smart ETA Calculation
- ✅ **Base time**: Calculated from current speed
- ✅ **Weather delays**: Added automatically
- ✅ **Traffic delays**: Added automatically
- ✅ **Confidence levels**: 
  - HIGH: Clear weather, light traffic
  - MEDIUM: Rain or moderate traffic
  - LOW: Storm or heavy traffic

### Acceleration/Deceleration
- ✅ **Realistic acceleration**: 3 mph/second (0-60 in ~20 seconds)
- ✅ **Realistic braking**: 5 mph/second
- ✅ **Speed variations**: ±3 mph random fluctuations
- ✅ **Smooth movement**: No instant speed changes

---

## 🧪 Testing Without API Keys

If you don't add API keys, the system will:
- Show a warning in the browser console
- **Automatically fall back to mock data** (random weather/traffic)
- Continue to work normally (just without real data)

This allows you to test the app immediately without waiting for API keys.

---

## 📊 API Usage Monitoring

### OpenWeatherMap
- Dashboard: https://home.openweathermap.org/api_keys
- Shows calls per day
- Updates weather every **5 minutes** (12 calls/hour = ~288/day)

### TomTom
- Dashboard: https://developer.tomtom.com/user/me/apps
- Shows API usage statistics
- Updates traffic every **5 minutes** (12 calls/hour = ~288/day)

**Total daily calls**: ~576 (well within free limits)

---

## 🔧 Troubleshooting

### "API key not configured" warning
- Check that you've added the keys to `.env.local`
- Make sure you've restarted the dev server after adding keys
- Verify the keys have the `VITE_` prefix

### OpenWeatherMap "401 Unauthorized"
- Your API key may not be activated yet (wait 10 minutes - 2 hours)
- Check you copied the full API key
- Verify your account is verified (check email)

### TomTom "403 Forbidden"
- Make sure you created an app/project in TomTom dashboard
- Check the API key is copied correctly
- Verify the Traffic Flow API is enabled for your key

### Weather/Traffic not updating
- Check browser console for error messages
- Data updates every 5 minutes (not instant)
- Fallback to mock data if API fails

---

## 📈 Benefits of Real APIs

✅ **Realistic simulation** - Matches actual truck driving behavior
✅ **Accurate ETAs** - Accounts for real weather and traffic
✅ **Professional appearance** - Shows real-world conditions
✅ **Educational** - Demonstrates API integration best practices
✅ **Scalable** - Easy to add more data sources

---

## 🎯 Next Steps

1. Get your API keys (15 minutes total)
2. Add them to `.env.local`
3. Restart server: `npm run dev`
4. Watch the truck move with realistic speeds!
5. See real weather and traffic conditions

Enjoy your enhanced logistics tracking system! 🚚📦
