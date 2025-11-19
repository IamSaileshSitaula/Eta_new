
import { GoogleGenAI } from "@google/genai";
import { ConfidenceLevel } from '../types';

// Assume process.env.API_KEY is configured in the environment
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.warn("API_KEY for Gemini is not set. AI features will be disabled.");
}

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

export const getDelayExplanation = async (
  delayMinutes: number,
  cause: string,
  confidence: ConfidenceLevel
): Promise<string> => {
  if (!ai) {
    return `AI service is unavailable. Delay of ${delayMinutes} minutes due to ${cause}.`;
  }
  
  const prompt = `
    You are a logistics communication assistant.
    A shipment is delayed by ${delayMinutes} minutes.
    The primary cause is: ${cause}.
    The confidence in this assessment is ${confidence}.
    
    Generate a concise, user-friendly explanation for the B2B client receiving the shipment.
    Start with the delay time. Be professional and clear. Do not use apologetic language.
    Example: "A ${delayMinutes}-minute delay is expected due to ${cause.toLowerCase()}. Our systems are actively monitoring the situation."
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("Error fetching explanation from Gemini API:", error);
    return `A delay of approximately ${delayMinutes} minutes is anticipated due to ${cause}.`;
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

