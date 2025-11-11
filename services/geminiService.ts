
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
