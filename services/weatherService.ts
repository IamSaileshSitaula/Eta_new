import { Coordinates, WeatherData } from '../types';

const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

// Cache for weather data to reduce API calls
const weatherCache = new Map<string, { data: WeatherData; timestamp: number }>();
const CACHE_TTL_MS = 300000; // 5 minutes cache (weather changes slowly)
const REQUEST_TIMEOUT_MS = 5000; // 5 second timeout

interface OpenWeatherResponse {
  weather: Array<{
    id: number;
    main: string;
    description: string;
  }>;
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
  };
  wind: {
    speed: number;
    deg: number;
  };
  visibility: number;
  rain?: {
    '1h': number;
  };
  snow?: {
    '1h': number;
  };
}

/**
 * Generate cache key for location
 */
function getCacheKey(lat: number, lon: number): string {
  // Round to 2 decimal places (~1km precision) for cache grouping
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch real-time weather data from OpenWeatherMap API
 * @param location - Coordinates [lat, lon]
 * @returns Weather data including condition, temperature, and description
 */
export const fetchRealWeatherData = async (location: Coordinates): Promise<WeatherData> => {
  const OPENWEATHER_API_KEY = import.meta.env.VITE_OPENWEATHER_API_KEY;
  
  console.log('🌤️ Weather API - Key status:', OPENWEATHER_API_KEY ? 'CONFIGURED' : 'MISSING');
  
  if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === 'your_openweather_api_key_here') {
    throw new Error('OpenWeatherMap API key not configured');
  }

  const [lat, lon] = location;
  
  // Check cache first
  const cacheKey = getCacheKey(lat, lon);
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('📦 Using cached weather data');
    return cached.data;
  }
  
  console.log(`🌤️ Fetching real weather data for [${lat}, ${lon}]`);
  const url = `${OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
  
  try {
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    
    console.log('🌤️ API Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`🌤️ API Error Response:`, errorText);
      throw new Error(`OpenWeather API error: ${response.status}`);
    }
    
    const data: OpenWeatherResponse = await response.json();
  
    console.log('🌤️ Raw weather data:', {
      weatherId: data.weather[0]?.id,
      main: data.weather[0]?.main,
      description: data.weather[0]?.description,
      temp: data.main.temp
    });
    
    // Determine condition based on weather code
    let condition: WeatherData['condition'] = 'Clear';
    const weatherId = data.weather[0]?.id || 800;
    
    if (weatherId >= 200 && weatherId < 300) {
      // Thunderstorm
      condition = 'Storm';
    } else if (weatherId >= 300 && weatherId < 600) {
      // Drizzle or Rain
      condition = 'Rain';
    } else if (weatherId >= 600 && weatherId < 700) {
      // Snow
      condition = 'Storm'; // Treat snow as storm for driving impact
    } else if (weatherId >= 700 && weatherId < 800) {
      // Atmosphere (fog, mist, etc.)
      condition = 'Rain'; // Treat fog/mist as rain for caution
    } else if (weatherId === 800) {
      // Clear
      condition = 'Clear';
    } else if (weatherId > 800) {
      // Clouds
      condition = 'Clear'; // Cloudy but drivable
    }
    
    // Enhanced description with driving impact
    let description = data.weather[0]?.description || 'Unknown conditions';
    description = description.charAt(0).toUpperCase() + description.slice(1);
    
    // Add driving impact information
    if (condition === 'Storm') {
      description += '. Severe weather - reduced visibility and road hazards.';
    } else if (condition === 'Rain') {
      description += '. Wet roads - drive with caution.';
    } else {
      description += '. Good driving conditions.';
    }
    
    // Add visibility information if poor
    if (data.visibility < 1000) {
      description += ` Low visibility: ${Math.round(data.visibility * 3.28084)} ft.`;
    }
    
    // Add wind warning for trucks
    const windSpeedMph = data.wind.speed;
    if (windSpeedMph > 25) {
      description += ` High winds: ${Math.round(windSpeedMph)} mph - crosswinds may affect large vehicles.`;
    }
    
    console.log('✅ OpenWeatherMap data retrieved successfully:', { condition, temperature: Math.round(data.main.temp) });
    
    const result: WeatherData = {
      condition,
      temperature: Math.round(data.main.temp), // Already in Fahrenheit
      description
    };

    // Cache the result
    weatherCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return result;
  } catch (error) {
    // If it's an abort error (timeout), throw a specific message
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Weather API request timed out');
    }
    throw error;
  }
};

/**
 * Calculate weather impact multiplier on vehicle speed
 * @param weather - Current weather data
 * @returns Speed multiplier (0.0 to 1.0)
 */
export const getWeatherSpeedMultiplier = (weather: WeatherData | null): number => {
  if (!weather) return 1.0;
  
  switch (weather.condition) {
    case 'Clear':
      return 1.0; // 100% normal speed
    case 'Rain':
      // Light to moderate rain: 70-80% speed
      return 0.75;
    case 'Storm':
      // Heavy rain, thunderstorm, snow: 50-60% speed
      return 0.55;
    default:
      return 1.0;
  }
};

/**
 * Get weather-based delay in minutes for ETA calculation
 * @param weather - Current weather data
 * @param distanceMiles - Remaining distance in miles
 * @returns Estimated delay in minutes
 */
export const getWeatherDelay = (weather: WeatherData | null, distanceMiles: number): number => {
  if (!weather) return 0;
  
  const multiplier = getWeatherSpeedMultiplier(weather);
  
  if (multiplier >= 1.0) return 0;
  
  // Cap the affected distance to 50 miles (assume weather is regional, not entire route)
  const affectedDistance = Math.min(distanceMiles, 50);

  // Calculate additional time due to slower speed
  // Assuming base speed of 55 mph
  const baseSpeed = 55;
  const adjustedSpeed = baseSpeed * multiplier;
  const normalTime = (affectedDistance / baseSpeed) * 60; // minutes
  const adjustedTime = (affectedDistance / adjustedSpeed) * 60;
  
  return Math.round(adjustedTime - normalTime);
};
