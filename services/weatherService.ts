import { Coordinates, WeatherData } from '../types';

const OPENWEATHER_API_KEY = (import.meta as any).env?.VITE_OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

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
 * Fetch real-time weather data from OpenWeatherMap API
 * @param location - Coordinates [lat, lon]
 * @returns Weather data including condition, temperature, and description
 */
export const fetchRealWeatherData = async (location: Coordinates): Promise<WeatherData> => {
  if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === 'your_openweather_api_key_here') {
    console.warn('OpenWeatherMap API key not configured. Using mock data.');
    return fetchMockWeatherData();
  }

  try {
    const [lat, lon] = location;
    const url = `${OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenWeatherMap API error: ${response.status}`);
    }
    
    const data: OpenWeatherResponse = await response.json();
    
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
    
    return {
      condition,
      temperature: Math.round(data.main.temp), // Already in Fahrenheit
      description
    };
  } catch (error) {
    console.error('Error fetching weather data:', error);
    return fetchMockWeatherData();
  }
};

/**
 * Fallback mock weather data when API is unavailable
 */
const fetchMockWeatherData = (): WeatherData => {
  const conditions: WeatherData['condition'][] = ['Clear', 'Rain', 'Storm'];
  const condition = conditions[Math.floor(Math.random() * conditions.length)];
  
  let description = 'Clear skies. Good driving conditions.';
  if (condition === 'Rain') description = 'Light showers, roads may be wet. Drive with caution.';
  if (condition === 'Storm') description = 'Thunderstorm warning in effect. Severe weather - reduced visibility.';
  
  return {
    condition,
    temperature: 72, // Fahrenheit
    description
  };
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
  
  // Calculate additional time due to slower speed
  // Assuming base speed of 55 mph
  const baseSpeed = 55;
  const adjustedSpeed = baseSpeed * multiplier;
  const normalTime = (distanceMiles / baseSpeed) * 60; // minutes
  const adjustedTime = (distanceMiles / adjustedSpeed) * 60;
  
  return Math.round(adjustedTime - normalTime);
};
