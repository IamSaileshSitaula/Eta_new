import { GoogleGenAI } from "@google/genai";
import { ConfidenceLevel, Stop, ShipmentItem } from '../types';

// Assume process.env.API_KEY is configured in the environment
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.warn("API_KEY for Gemini is not set. AI features will be disabled.");
}

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

export const getDelayExplanation = async (
  delayMinutes: number,
  cause: string,
  confidence: ConfidenceLevel,
  etaChangeMinutes?: number,
  originalEta?: number,
  newEta?: number,
  speedData?: { current: number; normal: number }
): Promise<string> => {
  if (!ai) {
    return `A delay of approximately ${delayMinutes} minutes is expected due to ${cause}.`;
  }

  const prompt = `
    You are a helpful logistics assistant communicating with a customer or supplier.
    
    Context:
    - A delivery is delayed.
    - Current Delay: ${delayMinutes} minutes.
    - Cause: ${cause}.
    - Confidence: ${confidence}.
    ${etaChangeMinutes ? `- The ETA has increased by ${etaChangeMinutes} minutes.` : ''}
    ${speedData ? `- Traffic Speed: Moving at ${speedData.current} mph (Normal: ${speedData.normal} mph).` : ''}
    
    Task:
    Generate a clear, reassuring explanation (1-2 sentences).
    - If confidence is Low or delay is large (>60 mins), emphasize that this is a *projection* based on current slow speeds and likely an overestimation that will correct itself.
    - Mention the speed drop if relevant (e.g. "traffic has slowed to ${speedData?.current || 'low'} mph").
    - Only mention weather if it is NOT "Clear".
    - Use plain English (no jargon).
    - Do NOT apologize (keep it neutral and informative).
    
    Examples:
    - "Heavy traffic has slowed vehicles to 22 mph, causing a projected delay of 45 minutes, though this may improve."
    - "Current congestion suggests a significant delay, but this estimate is likely high and will adjust as traffic clears."
    - "Stormy weather and reduced speeds (35 mph) are impacting the timeline."
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text.trim();
  } catch (error) {
    console.error("Error fetching explanation from Gemini API:", error);
    return `A delay of approximately ${delayMinutes} minutes is expected due to ${cause}.`;
  }
};

/**
 * Predict unloading time based on item type and quantity using Gemini AI
 */
export const predictUnloadingTime = async (
  itemType: string,
  quantity: number
): Promise<number> => {
  if (!ai) {
    // Fallback: Simple estimation without AI
    const baseTime = 5; // 5 minutes base time
    const perItemTime = itemType.toLowerCase().includes('mattress') ||
      itemType.toLowerCase().includes('furniture') ? 3 : 1;
    return Math.max(5, baseTime + (quantity * perItemTime));
  }

  const prompt = `
    You are a logistics timing expert specializing in truck delivery operations.
    
    Task: Estimate the unloading time for a delivery truck.
    
    Item Type: ${itemType}
    Quantity: ${quantity}
    
    Consider factors like:
    - Item weight and size (mattresses and furniture take longer)
    - Whether items need to be carried vs wheeled
    - Typical unloading procedures
    - Driver capabilities (one person unloading)
    
    Respond with ONLY a number representing minutes (integer). 
    Minimum: 5 minutes (for paperwork/setup)
    Maximum: 60 minutes (for very large deliveries)
    
    Example responses: "15" or "25" or "8"
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    const timeText = response.text.trim();
    const minutes = parseInt(timeText.replace(/[^\d]/g, ''));

    // Validate and constrain the response
    if (isNaN(minutes) || minutes < 5) return 5;
    if (minutes > 60) return 60;

    console.log(`🤖 Gemini predicted unloading time: ${minutes} minutes for ${quantity} ${itemType}`);
    return minutes;
  } catch (error) {
    console.error("Error fetching unloading time from Gemini API:", error);
    // Fallback calculation
    const baseTime = 5;
    const perItemTime = itemType.toLowerCase().includes('mattress') ||
      itemType.toLowerCase().includes('furniture') ? 3 : 1;
    return Math.max(5, baseTime + (quantity * perItemTime));
  }
};

/**
 * Calculate unloading times for multiple stops based on their items
 */
export const calculateBatchUnloadingTimes = async (
  stops: Stop[],
  items: ShipmentItem[]
): Promise<Record<string, number>> => {
  if (!ai) {
    // Fallback: Simple estimation without AI
    const results: Record<string, number> = {};
    stops.forEach(stop => {
      const stopItems = items.filter(item => item.destinationStopId === stop.id);
      let totalMinutes = 5; // Base time
      
      stopItems.forEach(item => {
        const perItemTime = item.contents.toLowerCase().includes('mattress') ||
          item.contents.toLowerCase().includes('furniture') ? 3 : 1;
        totalMinutes += item.quantity * perItemTime;
      });
      
      results[stop.id] = totalMinutes;
    });
    return results;
  }

  // Prepare data for prompt
  const stopsData = stops.map(stop => {
    const stopItems = items.filter(item => item.destinationStopId === stop.id);
    const itemsDesc = stopItems.map(i => `${i.quantity}x ${i.contents}`).join(', ');
    return `Stop ID: ${stop.id}, Name: ${stop.name}, Items: ${itemsDesc || 'None'}`;
  }).join('\n');

  const prompt = `
    You are a logistics expert. Calculate the estimated unloading time (in minutes) for each of the following delivery stops.
    
    Consider:
    - Item quantity and type (heavy/bulky items like mattresses take longer)
    - Base time for parking and paperwork (approx 5 mins)
    - 1-2 minutes per standard item, 3-5 minutes per bulky item
    
    Stops:
    ${stopsData}
    
    Return ONLY a JSON object where keys are Stop IDs and values are the estimated minutes (integer).
    Example: {"stop-1": 15, "stop-2": 8}
    Do not include markdown formatting or explanations.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    
    const text = response.text.trim().replace(/```json|```/g, '');
    const times = JSON.parse(text);
    console.log('🤖 Gemini calculated batch unloading times:', times);
    return times;
  } catch (error) {
    console.error("Error fetching batch unloading times from Gemini API:", error);
    // Fallback
    const results: Record<string, number> = {};
    stops.forEach(stop => {
      const stopItems = items.filter(item => item.destinationStopId === stop.id);
      let totalMinutes = 5;
      stopItems.forEach(item => {
        const perItemTime = item.contents.toLowerCase().includes('mattress') ||
          item.contents.toLowerCase().includes('furniture') ? 3 : 1;
        totalMinutes += item.quantity * perItemTime;
      });
      results[stop.id] = totalMinutes;
    });
    return results;
  }
};

