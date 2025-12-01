import { GoogleGenAI, Modality } from "@google/genai";

/**
 * Generates speech from text using Gemini 2.5 Flash TTS
 */
export const generateSpeechSegment = async (
  text: string,
  voiceName: string = 'Kore',
  systemInstruction?: string,
  speed: string = 'Normal'
): Promise<string> => {
  try {
    // Check for API Key at runtime
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("API Key not found. Please add 'API_KEY' to your Netlify Environment Variables and redeploy.");
    }

    // Initialize client per request to ensure valid key usage
    const ai = new GoogleGenAI({ apiKey });

    // Construct configuration object
    const config: any = {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName },
        },
      },
    };

    // Construct full instruction text
    let instructions = systemInstruction ? systemInstruction.trim() : "";
    
    // Append speed instruction if not normal
    if (speed && speed !== 'Normal') {
        const speedPrompt = speed === 'Fast' ? "Speak at a fast pace." : 
                            speed === 'Very Fast' ? "Speak very quickly." : 
                            "Speak slowly.";
        
        instructions = instructions ? `${instructions} ${speedPrompt}` : speedPrompt;
    }

    // Embed instructions into the prompt text itself
    // This avoids API errors with systemInstruction config in TTS models and often ensures better adherence
    let promptText = text;
    if (instructions.length > 0) {
       promptText = `${instructions}\n\n${text}`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: promptText }] }],
      config: config,
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      throw new Error("No audio data received. The model might have blocked the request.");
    }

    // Convert Base64 to Blob
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Create Wav URL
    return createWavUrl(bytes, 24000); 

  } catch (error: any) {
    console.error("Error generating speech:", error);
    
    // Attempt to extract meaningful message from error object or string
    let errorMessage = error.message || "Unknown API Error";
    
    // Check if the error message is a JSON string (common with some client errors)
    if (typeof errorMessage === 'string' && (errorMessage.includes('{') && errorMessage.includes('}'))) {
        try {
            // regex to find JSON object
            const jsonMatch = errorMessage.match(/\{.*\}/);
            if (jsonMatch) {
                const errorObj = JSON.parse(jsonMatch[0]);
                if (errorObj.error && errorObj.error.message) {
                    errorMessage = `${errorObj.error.message}`;
                    if(errorObj.error.code) errorMessage += ` (Code: ${errorObj.error.code})`;
                } else if (errorObj.message) {
                    errorMessage = errorObj.message;
                }
            }
        } catch (e) {
            // If parsing fails, use original message
        }
    }

    throw new Error(errorMessage);
  }
};

/**
 * Helper to add a WAV header to raw PCM data so it plays in standard players
 * 24000Hz is the sample rate used in the Gemini guidelines examples
 */
export const createWavUrl = (samples: Uint8Array, sampleRate: number): string => {
  const buffer = new ArrayBuffer(44 + samples.length);
  const view = new DataView(buffer);

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + samples.length, true);
  // RIFF type
  writeString(view, 8, 'WAVE');
  // format chunk identifier
  writeString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (raw)
  view.setUint16(20, 1, true);
  // channel count (1)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * blockAlign)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channel count * bytes per sample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, samples.length, true);

  // Write the PCM samples
  const pcmData = new Uint8Array(buffer, 44);
  pcmData.set(samples);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};