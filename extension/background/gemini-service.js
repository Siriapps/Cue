/**
 * Gemini 3 API Service
 * Handles text summarization and video script generation
 */

import { CONFIG } from '../utils/constants.js';

/**
 * Generate text summary from meeting transcript using Gemini 3
 * @param {string} transcript - Meeting transcript
 * @returns {Promise<{success: boolean, summary?: Object, error?: string}>}
 */
export async function generateTextSummary(transcript) {
  try {
    console.log('Generating text summary with Gemini...');

    const prompt = `You are an AI meeting assistant specialized in creating clear, actionable meeting summaries.

Analyze the following meeting transcript and create a comprehensive summary.

TRANSCRIPT:
${transcript}

Return your response as a valid JSON object with this exact structure:
{
  "title": "A concise meeting title inferred from the content",
  "summary": ["Key point 1", "Key point 2", "Key point 3", "...up to 5 key points"],
  "decisions": ["Decision 1 that was made", "Decision 2", "..."],
  "actionItems": [
    {"task": "Task description", "owner": "Person responsible or 'Unassigned'", "deadline": "Deadline if mentioned or 'TBD'"},
    {"task": "Another task", "owner": "Owner", "deadline": "Deadline"}
  ],
  "keyTopics": ["Topic 1", "Topic 2", "Topic 3"],
  "participants": ["Name 1", "Name 2"],
  "mood": "productive|tense|creative|informational|collaborative",
  "duration_estimate": "Estimated meeting length based on content"
}

Important:
- Extract ALL action items mentioned
- Identify WHO is responsible for each action if mentioned
- Keep summary points concise but informative
- Detect the overall mood/tone of the meeting
- If information is not available, use reasonable defaults

Return ONLY the JSON object, no additional text.`;

    const response = await callGeminiAPI(prompt);
    
    if (!response.success) {
      return response;
    }

    // Parse JSON from response
    const summary = parseJSONResponse(response.text);
    
    if (!summary) {
      return { success: false, error: 'Failed to parse summary response' };
    }

    console.log('Text summary generated successfully');
    return { success: true, summary };
  } catch (error) {
    console.error('Gemini text summary error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate video script and style selection using Gemini 3
 * @param {Object} summary - Meeting summary object
 * @returns {Promise<{success: boolean, videoScript?: Object, error?: string}>}
 */
export async function generateVideoScript(summary) {
  try {
    console.log('Generating video script with Gemini...');

    const prompt = `You are a creative video director who transforms meeting summaries into engaging visual explanations.

Given this meeting summary, create a video script that will be used to generate an AI explainer video with Veo 3.

MEETING SUMMARY:
${JSON.stringify(summary, null, 2)}

Your task:
1. DECIDE the best video style based on the meeting content:
   - "animated_diagram": For technical/process discussions → Use flowcharts, diagrams animating, tech visuals
   - "whiteboard": For brainstorming/creative meetings → Hand-drawn style, ideas sketching, colorful
   - "presenter": For status updates/announcements → Professional presenter explaining with graphics
   - "story": For problem-solving/journey discussions → Narrative with scenes, characters, progression

2. CREATE a scene-by-scene video script optimized for Veo 3 generation

Return your response as a valid JSON object with this exact structure:
{
  "selectedStyle": "animated_diagram|whiteboard|presenter|story",
  "reasoning": "Brief explanation of why this style fits the meeting content",
  "videoDurationSeconds": 45,
  "videoTitle": "Catchy title for the video summary",
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": 10,
      "visualDescription": "Detailed description of what appears visually. Be specific about colors, movements, elements on screen.",
      "narration": "The exact voiceover text for this scene",
      "keyInsight": "The main takeaway from this scene",
      "transition": "How this scene transitions to the next (fade, slide, zoom, etc.)"
    },
    {
      "sceneNumber": 2,
      "duration": 12,
      "visualDescription": "Visual description...",
      "narration": "Voiceover text...",
      "keyInsight": "Main point...",
      "transition": "Transition type..."
    }
  ],
  "veoPrompt": "Complete, detailed prompt optimized for Veo 3 video generation that captures the entire video concept. Include style, mood, pacing, visual elements, and narration guidance. Make it vivid and specific.",
  "thumbnailDescription": "Description for a thumbnail image",
  "backgroundMusic": "Suggested music mood (upbeat, calm, professional, inspiring)"
}

Guidelines for the Veo 3 prompt:
- Be extremely detailed and visual
- Describe camera movements, colors, typography
- Specify the pacing and energy level
- Include specific visual metaphors for abstract concepts
- Make it 150-300 words for best results

Return ONLY the JSON object, no additional text.`;

    const response = await callGeminiAPI(prompt);
    
    if (!response.success) {
      return response;
    }

    // Parse JSON from response
    const videoScript = parseJSONResponse(response.text);
    
    if (!videoScript) {
      return { success: false, error: 'Failed to parse video script response' };
    }

    console.log(`Video script generated. Style: ${videoScript.selectedStyle}, Scenes: ${videoScript.scenes?.length}`);
    return { success: true, videoScript };
  } catch (error) {
    console.error('Gemini video script error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Call Gemini API with a prompt
 * @param {string} prompt - The prompt to send
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
async function callGeminiAPI(prompt) {
  try {
    const apiUrl = `${CONFIG.GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`;
    console.log('Calling Gemini API for text generation...');
    
    const response = await fetch(
      apiUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_NONE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_NONE"
            }
          ]
        })
      }
    );

    if (!response.ok) {
      let errorMessage = `API error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.error?.message || errorMessage;
        console.error('Gemini API error:', errorData);
      } catch (e) {
        const errorText = await response.text().catch(() => '');
        console.error('Gemini API error (non-JSON):', errorText);
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

    // Extract text from response
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) {
      console.error('No text in response:', JSON.stringify(data, null, 2));
      return { success: false, error: 'No response text from Gemini. Check console for details.' };
    }

    return { success: true, text };
  } catch (error) {
    console.error('Gemini API call error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Parse JSON from potentially messy API response
 * @param {string} text - Response text that may contain JSON
 * @returns {Object|null}
 */
function parseJSONResponse(text) {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // Continue to next attempt
      }
    }

    // Try to find JSON object in text
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        // Continue to next attempt
      }
    }

    console.error('Failed to parse JSON from response:', text.substring(0, 200));
    return null;
  }
}

/**
 * Mock summary generation for testing
 * @returns {Promise<{success: boolean, summary: Object}>}
 */
export async function mockTextSummary() {
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  return {
    success: true,
    summary: {
      title: "Chrome Flow Project Kickoff Meeting",
      summary: [
        "Project kickoff for Chrome Flow extension development",
        "Gemini integration for text summarization is complete",
        "Moving forward with Veo 3 video generation feature",
        "React chosen for UI development",
        "Fallback mechanisms planned for reliability"
      ],
      decisions: [
        "Use React for popup and summary page UI",
        "Video generation will be async to prevent blocking",
        "Text-only summary fallback if video fails"
      ],
      actionItems: [
        { task: "Complete audio capture module", owner: "John", deadline: "Friday" },
        { task: "Test Gemini prompts for quality", owner: "Sarah", deadline: "TBD" },
        { task: "Design summary page layout", owner: "Mike", deadline: "TBD" }
      ],
      keyTopics: ["Chrome Extension", "Gemini AI", "Veo 3", "React UI"],
      participants: ["John", "Sarah", "Mike"],
      mood: "productive",
      duration_estimate: "15 minutes"
    }
  };
}

/**
 * Mock video script generation for testing
 * @returns {Promise<{success: boolean, videoScript: Object}>}
 */
export async function mockVideoScript() {
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  return {
    success: true,
    videoScript: {
      selectedStyle: "animated_diagram",
      reasoning: "Technical project discussion benefits from flowcharts and diagrams to visualize the development process",
      videoDurationSeconds: 45,
      videoTitle: "Chrome Flow: Your AI Meeting Assistant",
      scenes: [
        {
          sceneNumber: 1,
          duration: 10,
          visualDescription: "Opening with a sleek purple gradient background. The Chrome Flow logo animates in with a subtle glow. Text 'Project Kickoff Summary' fades in below.",
          narration: "Welcome to your Chrome Flow meeting summary. Here's what happened in today's project kickoff.",
          keyInsight: "Introduction to the meeting summary",
          transition: "Smooth zoom out"
        },
        {
          sceneNumber: 2,
          duration: 15,
          visualDescription: "Animated flowchart appears showing three connected nodes: 'Audio Capture' → 'Gemini AI' → 'Veo 3'. Each node lights up sequentially with icons.",
          narration: "The team discussed the core architecture. Audio capture feeds into Gemini for summarization, then Veo 3 generates visual explanations.",
          keyInsight: "Technical architecture overview",
          transition: "Slide left"
        },
        {
          sceneNumber: 3,
          duration: 12,
          visualDescription: "Three decision cards animate in from the right. Each card has a checkmark icon and decision text. Cards stack neatly.",
          narration: "Key decisions were made: React for the UI, async video generation, and text fallbacks for reliability.",
          keyInsight: "Key decisions made",
          transition: "Fade"
        },
        {
          sceneNumber: 4,
          duration: 8,
          visualDescription: "Action items appear as a dynamic checklist with names and deadlines. Subtle animations highlight each item.",
          narration: "Action items assigned: John on audio capture, Sarah testing prompts, and Mike on design.",
          keyInsight: "Clear action items with ownership",
          transition: "Zoom to logo"
        }
      ],
      veoPrompt: "Create a 45-second professional explainer video summarizing a tech project meeting. Style: modern, clean, with animated diagrams and flowcharts. Color scheme: deep purple gradients with white and cyan accents. The video should open with a glowing logo reveal, then show an animated flowchart of three connected systems (audio → AI → video). Include floating cards showing decisions, and end with a dynamic checklist of action items. Use smooth transitions, subtle particle effects, and professional motion graphics. Mood: innovative, productive, tech-forward. Typography: clean sans-serif fonts with subtle animations. Include icons representing microphones, AI brains, and video cameras.",
      thumbnailDescription: "Purple gradient background with Chrome Flow logo and text 'Meeting Summary' with subtle tech icons",
      backgroundMusic: "upbeat professional"
    }
  };
}

export default {
  generateTextSummary,
  generateVideoScript,
  mockTextSummary,
  mockVideoScript
};
