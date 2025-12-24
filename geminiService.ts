
import { GoogleGenAI, Type } from "@google/genai";
import { VehicleRecord, ExpansionSuggestion } from "./types";

// Always use const ai = new GoogleGenAI({apiKey: process.env.API_KEY});
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const vehicleSchema = {
  type: Type.OBJECT,
  properties: {
    Manufacturer: { type: Type.STRING },
    Model: { type: Type.STRING },
    Generation: { 
      type: Type.STRING,
      description: "The numeric identifier of the generation only (e.g., '5' instead of 'Gen 5' or 'Mk 5')."
    },
    Model_Code: { type: Type.STRING },
    Start_Year: { type: Type.INTEGER },
    End_Year: { type: Type.STRING },
  },
  required: ["Manufacturer", "Model", "Generation", "Model_Code", "Start_Year", "End_Year"]
};

export const initializeDatabase = async (): Promise<VehicleRecord[]> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `ACTION: INITIALIZE_DATABASE
TASK: Generate a starting vehicle database for popular manufacturers: Toyota, Hyundai, Skoda, Suzuki, BMW, and Mercedes-Benz. 
Provide 2-4 recent generations for each. 
CRITICAL RULE: The 'Generation' field must contain ONLY the numeric digit (e.g., "5"). Do not include words like "Gen", "Generation", or "Mk".
Ensure values for 'End_Year' are either a 4-digit year or 'Present'.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: vehicleSchema
      }
    }
  });

  try {
    // Correctly accessing the text property from GenerateContentResponse
    return JSON.parse(response.text || '[]');
  } catch (e) {
    console.error("Failed to parse initialization response", e);
    return [];
  }
};

export const suggestExpansion = async (
  manufacturer: string | 'ALL', 
  currentData: VehicleRecord[],
  modelName: string = 'ALL'
): Promise<ExpansionSuggestion[]> => {
  const isAllMan = manufacturer === 'ALL';
  const isSpecificModel = modelName !== 'ALL';
  
  const context = isAllMan 
    ? JSON.stringify(currentData.slice(0, 150)) 
    : JSON.stringify(currentData.filter(v => v.Manufacturer.toLowerCase() === manufacturer.toLowerCase()));

  let taskDescription = "";
  if (isAllMan) {
    taskDescription = "Analyze the entire provided vehicle database context. Suggest up to 50 missing critical generations or models across all major global brands.";
  } else if (isSpecificModel) {
    taskDescription = `Focus specifically on the model "${modelName}" from "${manufacturer}". Suggest up to 20 missing historical and recent generations for this specific model that are not present in the provided context.`;
  } else {
    taskDescription = `Analyze the current data for "${manufacturer}". Suggest up to 40 missing generations or common models (like top sellers and variants) not present in the database.`;
  }

  const prompt = `ACTION: SUGGEST_EXPANSION
${isAllMan ? "" : `INPUT_MANUFACTURER: ${manufacturer}`}
${isSpecificModel ? `TARGET_MODEL: ${modelName}` : ""}
TASK: ${taskDescription}
CRITICAL RULE: The 'Generation' field must contain ONLY the numeric digit (e.g., "5"). Do not include words like "Gen", "Generation", or "Mk".
CURRENT_DATA_CONTEXT: ${context}`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: vehicleSchema
      }
    }
  });

  try {
    // Correctly accessing the text property from GenerateContentResponse
    return JSON.parse(response.text || '[]');
  } catch (e) {
    console.error("Failed to parse expansion response", e);
    return [];
  }
};
