/**
 * Transcription using Gemini Native Audio
 * Gemini can accept audio directly - no separate STT service needed!
 */

import { CONFIG } from '../utils/constants.js';

/**
 * Transcribe audio using Gemini's native audio understanding
 * This is simpler than using a separate STT service
 * @param {Blob} audioBlob - Audio blob to transcribe
 * @returns {Promise<{success: boolean, transcript?: string, error?: string}>}
 */
export async function transcribeAudio(audioBlob) {
  try {
    console.log(`Transcribing audio with Gemini. Size: ${audioBlob.size} bytes`);

    // Convert blob to base64
    const base64Audio = await blobToBase64(audioBlob);
    
    // Get MIME type
    const mimeType = audioBlob.type || 'audio/webm';

    // Call Gemini with audio input
    const apiUrl = `${CONFIG.GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`;
    console.log('Calling Gemini transcription API...');
    
    const response = await fetch(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Audio
                }
              },
              {
                text: `Transcribe this audio recording of a meeting. 
                
Provide ONLY the transcript text, nothing else. Include speaker labels if you can identify different speakers (e.g., "Speaker 1:", "Speaker 2:").

Keep the transcript accurate and include all spoken content.`
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1, // Low temperature for accurate transcription
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
        console.error('Gemini transcription error:', errorData);
      } catch (e) {
        const errorText = await response.text().catch(() => '');
        console.error('Gemini transcription error (non-JSON):', errorText);
        errorMessage = errorText || errorMessage;
      }
      return { 
        success: false, 
        error: errorMessage
      };
    }

    const data = await response.json();
    
    // Check for blocked content or other issues
    if (data.candidates && data.candidates.length === 0) {
      const finishReason = data.candidates?.[0]?.finishReason || 'UNKNOWN';
      return { 
        success: false, 
        error: `Content blocked or invalid. Finish reason: ${finishReason}` 
      };
    }
    
    // Extract transcript from response
    const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!transcript) {
      console.error('No transcript in response:', JSON.stringify(data, null, 2));
      return { success: false, error: 'No transcript returned from Gemini. Check console for details.' };
    }

    console.log(`Transcription complete. Length: ${transcript.length} characters`);
    
    return {
      success: true,
      transcript: transcript.trim()
    };
  } catch (error) {
    console.error('Transcription error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Transcribe AND summarize in one Gemini call
 * This is even more efficient - combines two steps into one!
 * @param {Blob} audioBlob - Audio blob
 * @returns {Promise<{success: boolean, transcript?: string, summary?: Object, error?: string}>}
 */
export async function transcribeAndSummarize(audioBlob) {
  try {
    console.log(`Transcribing and summarizing audio with Gemini. Size: ${audioBlob.size} bytes`);

    // Convert blob to base64
    const base64Audio = await blobToBase64(audioBlob);
    const mimeType = audioBlob.type || 'audio/webm';

    const apiUrl = `${CONFIG.GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`;
    console.log('Calling Gemini transcribeAndSummarize API...');
    
    const response = await fetch(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Audio
                }
              },
              {
                text: `Listen to this meeting recording and provide:

1. A full transcript of what was said
2. A structured summary

Return your response as JSON with this exact structure:
{
  "transcript": "The full transcript text here...",
  "summary": {
    "title": "Meeting title inferred from content",
    "summary": ["Key point 1", "Key point 2", "Key point 3"],
    "decisions": ["Decision 1", "Decision 2"],
    "actionItems": [
      {"task": "Task description", "owner": "Person name or Unassigned", "deadline": "Deadline or TBD"}
    ],
    "keyTopics": ["Topic 1", "Topic 2"],
    "participants": ["Name 1", "Name 2"],
    "mood": "productive|creative|tense|informational|collaborative",
    "duration_estimate": "Estimated meeting length"
  }
}

Return ONLY valid JSON, no other text.`
              }
            ]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 8192
          }
        })
      }
    );

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
        console.error('Gemini transcribeAndSummarize error:', errorData);
      } catch (e) {
        const errorText = await response.text().catch(() => '');
        console.error('Gemini transcribeAndSummarize error (non-JSON):', errorText);
        errorMessage = errorText || errorMessage;
      }
      return { 
        success: false, 
        error: errorMessage
      };
    }

    const data = await response.json();
    
    // Check for blocked content
    if (data.candidates && data.candidates.length === 0) {
      return { 
        success: false, 
        error: 'Content blocked or invalid response from Gemini' 
      };
    }
    
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      console.error('No text in transcribeAndSummarize response:', JSON.stringify(data, null, 2));
      return { success: false, error: 'No response from Gemini. Check console for details.' };
    }

    // Parse JSON response
    const result = parseJSONResponse(text);
    
    if (!result) {
      return { success: false, error: 'Failed to parse Gemini response' };
    }

    console.log('Transcription and summary complete!');
    
    return {
      success: true,
      transcript: result.transcript,
      summary: result.summary
    };
  } catch (error) {
    console.error('Transcribe and summarize error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Convert blob to base64 string
 * @param {Blob} blob 
 * @returns {Promise<string>}
 */
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Remove data URL prefix to get pure base64
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Parse JSON from potentially messy API response
 * @param {string} text - Response text
 * @returns {Object|null}
 */
function parseJSONResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // Continue
      }
    }

    // Try to find JSON object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Continue
      }
    }

    console.error('Failed to parse JSON:', text.substring(0, 200));
    return null;
  }
}

/**
 * Mock transcription for demo/testing
 * @returns {Promise<{success: boolean, transcript: string}>}
 */
export async function mockTranscription() {
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    success: true,
    transcript: `Welcome everyone to today's project kickoff meeting. 
    
I wanted to start by discussing our main objectives for this quarter. First, we need to finalize the Chrome Flow extension design and get it ready for the hackathon submission.

Sarah mentioned earlier that the Gemini integration is progressing well. The text summarization is working, and we're now moving on to the video generation with Veo 3.

Key decisions from today:
1. We'll use React for the popup and summary page UI
2. The video generation will be async to not block the user experience
3. We should have a fallback to text-only summaries if video generation fails

Action items:
- John will complete the audio capture module by Friday
- Sarah will test the Gemini prompts for better summary quality
- Mike will design the summary page layout

Any questions? Great, let's reconvene next week with our progress.`
  };
}

export default {
  transcribeAudio,
  transcribeAndSummarize,
  mockTranscription
};
