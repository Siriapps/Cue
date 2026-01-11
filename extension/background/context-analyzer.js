/**
 * Context Analyzer Service
 * Uses Gemini to analyze page context and generate suggestions
 */

import { CONFIG } from '../utils/constants.js';

// Rate limiting: track last API call time
let lastAPICallTime = 0;
const MIN_API_INTERVAL = 2000; // Minimum 2 seconds between API calls

/**
 * Check if we can make an API call (rate limiting)
 */
function canMakeAPICall() {
  const now = Date.now();
  if (now - lastAPICallTime < MIN_API_INTERVAL) {
    return false;
  }
  lastAPICallTime = now;
  return true;
}

/**
 * Analyze page context and generate a helpful suggestion
 * @param {Object} context - Page context (title, url, domain, path)
 * @returns {Promise<{success: boolean, suggestion?: string}>}
 */
export async function analyzePageContext(context) {
  // Skip automatic context analysis to prevent 429 errors
  // This function is now only called on-demand, not automatically
  return { success: false, skipped: true };
  
  /* Original implementation disabled to prevent rate limiting
  try {
    const prompt = `You are an AI assistant integrated into a browser toolbar called "Chrome Flow".

The user is currently viewing a webpage:
- Title: ${context.title}
- URL: ${context.url}
- Domain: ${context.domain}

Based on this context, provide a VERY SHORT (under 15 words) helpful suggestion or insight.

Examples:
- "Looks like you're researching. Ready to take notes?"
- "Shopping? I can help compare prices."
- "Coding? I can explain this code."
- "Reading documentation. Need a summary?"

Be contextual and helpful. Return ONLY the suggestion text, nothing else.`;

    const response = await fetch(
      `${CONFIG.GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 50
          }
        })
      }
    );

    if (!response.ok) {
      return { success: false };
    }

    const data = await response.json();
    const suggestion = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (suggestion) {
      return { success: true, suggestion };
    }

    return { success: false };
  } catch (error) {
    console.error('Context analysis error:', error);
    return { success: false };
  }
  */
}

/**
 * Answer a user question about the current page
 * @param {Object} context - Page context with query and browsing history
 * @returns {Promise<{success: boolean, answer?: string, error?: string}>}
 */
export async function askAI(context) {
  try {
    // Rate limiting check
    if (!canMakeAPICall()) {
      return { 
        success: false, 
        error: 'Please wait a moment before asking another question. Rate limit protection active.' 
      };
    }

    // Build browsing history context
    let historyContext = '';
    if (context.browsingHistory && context.browsingHistory.length > 0) {
      historyContext = `\n\nBrowsing History (recent pages visited in this session):\n${context.browsingHistory.slice(-10).map((page, i) => 
        `${i + 1}. ${page.title} (${page.domain})`
      ).join('\n')}`;
      
      if (context.sessionActive) {
        historyContext += `\n\nSession active for ${context.sessionDuration || 0} minutes.`;
      }
    }

    const prompt = `You are an AI assistant integrated into a browser toolbar called "Chrome Flow".

The user is currently on this webpage:
- Title: ${context.title}
- URL: ${context.url}
${context.selectedText ? `- Selected text: "${context.selectedText.substring(0, 500)}}"` : ''}${historyContext}

User's question: ${context.query}

Provide a helpful, contextual answer. Use the browsing history to understand the user's workflow and intent.
If the question relates to the selected text, focus on that.
If the browsing history shows a pattern (e.g., researching, shopping, coding), use that context.
Be friendly, helpful, and concise (2-4 sentences unless more detail is needed).`;

    const response = await fetch(
      `${CONFIG.GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500
          }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(()=>({}));
      
      // Handle 429 Too Many Requests
      if (response.status === 429) {
        return { 
          success: false, 
          error: 'API rate limit exceeded. Please wait a moment and try again.' 
        };
      }
      
      return { 
        success: false, 
        error: errorData.error?.message || `API error (${response.status})` 
      };
    }

    const data = await response.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (answer) {
      return { success: true, answer };
    }

    return { success: false, error: 'No response from AI' };
  } catch (error) {
    console.error('Ask AI error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate a "next step" suggestion based on user activity
 * @param {Object} sessionData - Session data with visited pages, time, etc.
 * @returns {Promise<{success: boolean, insight?: Object}>}
 */
export async function generateNextStepInsight(sessionData) {
  try {
    const prompt = `You are an AI productivity assistant.

The user has been in a focused session for ${sessionData.duration} minutes.
They've visited these pages:
${sessionData.pages.map(p => `- ${p.title} (${p.domain})`).join('\n')}

Current page: ${sessionData.currentPage.title}

Based on their activity, suggest a logical next step.

Return JSON:
{
  "insight": "One sentence about what you noticed",
  "suggestion": "What they should do next",
  "action": "open_ide|take_notes|summarize|break|continue"
}`;

    const response = await fetch(
      `${CONFIG.GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 200
          }
        })
      }
    );

    if (!response.ok) {
      return { success: false };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    // Parse JSON from response
    try {
      const insight = JSON.parse(text);
      return { success: true, insight };
    } catch {
      // Try to extract JSON
      const match = text?.match(/\{[\s\S]*\}/);
      if (match) {
        const insight = JSON.parse(match[0]);
        return { success: true, insight };
      }
    }

    return { success: false };
  } catch (error) {
    console.error('Next step insight error:', error);
    return { success: false };
  }
}

export default {
  analyzePageContext,
  askAI,
  generateNextStepInsight
};
