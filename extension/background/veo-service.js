/**
 * Veo 3 Video Generation Service
 * Handles AI video generation using Google's Veo 3 API
 */

import { CONFIG } from '../utils/constants.js';

// Polling configuration
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_POLL_ATTEMPTS = 60; // 5 minutes max wait time

/**
 * Generate video using Veo 3 API
 * @param {Object} videoScript - Video script from Gemini
 * @returns {Promise<{success: boolean, videoUrl?: string, error?: string}>}
 */
export async function generateVideo(videoScript) {
  try {
    console.log('Starting Veo 3 video generation...');
    console.log('Video style:', videoScript.selectedStyle);
    console.log('Duration:', videoScript.videoDurationSeconds, 'seconds');

    // Build the optimized prompt for Veo 3
    const prompt = buildVeoPrompt(videoScript);

    // Start video generation (this returns an operation ID for long-running tasks)
    const response = await fetch(
      `${CONFIG.VEO_API_URL}?key=${CONFIG.VEO_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt,
          config: {
            aspectRatio: "16:9",
            durationSeconds: Math.min(videoScript.videoDurationSeconds || 45, 60),
            numberOfVideos: 1,
            personGeneration: "allow_adult", // For presenter style
            // Add style-specific configs
            ...getStyleConfig(videoScript.selectedStyle)
          }
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Veo 3 API error:', errorData);
      return {
        success: false,
        error: errorData.error?.message || `Veo 3 API error: ${response.status}`
      };
    }

    const data = await response.json();

    // Check if we got a direct video URL or need to poll
    if (data.video?.uri) {
      // Direct response with video
      console.log('Video generated immediately');
      return {
        success: true,
        videoUrl: data.video.uri
      };
    }

    if (data.name || data.operationId) {
      // Long-running operation - need to poll
      const operationId = data.name || data.operationId;
      console.log('Video generation started, operation ID:', operationId);
      return await pollForVideoCompletion(operationId);
    }

    // Alternative: Check for generated videos array
    if (data.generatedVideos && data.generatedVideos.length > 0) {
      const videoUri = data.generatedVideos[0].video?.uri;
      if (videoUri) {
        return { success: true, videoUrl: videoUri };
      }
    }

    return {
      success: false,
      error: 'Unexpected response format from Veo 3 API'
    };
  } catch (error) {
    console.error('Veo 3 generation error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Build optimized prompt for Veo 3 from video script
 * @param {Object} videoScript - Video script object
 * @returns {string}
 */
function buildVeoPrompt(videoScript) {
  // Use the pre-generated Veo prompt if available
  if (videoScript.veoPrompt) {
    return videoScript.veoPrompt;
  }

  // Build prompt from scenes
  const sceneDescriptions = videoScript.scenes
    .map(scene => `Scene ${scene.sceneNumber} (${scene.duration}s): ${scene.visualDescription}`)
    .join('\n\n');

  const basePrompt = `Create a ${videoScript.videoDurationSeconds || 45}-second professional explainer video.

Title: ${videoScript.videoTitle}
Style: ${videoScript.selectedStyle}
Mood: ${videoScript.backgroundMusic || 'professional'}

Scenes:
${sceneDescriptions}

Overall requirements:
- Smooth transitions between scenes
- Modern, clean visual style
- Professional motion graphics
- Clear visual hierarchy
- Engaging and informative`;

  return basePrompt;
}

/**
 * Get style-specific configuration for Veo 3
 * @param {string} style - Video style
 * @returns {Object}
 */
function getStyleConfig(style) {
  const configs = {
    animated_diagram: {
      stylePreset: 'motion_graphics',
      visualStyle: 'clean_modern'
    },
    whiteboard: {
      stylePreset: 'animated',
      visualStyle: 'hand_drawn'
    },
    presenter: {
      stylePreset: 'realistic',
      visualStyle: 'professional'
    },
    story: {
      stylePreset: 'cinematic',
      visualStyle: 'narrative'
    }
  };

  return configs[style] || configs.animated_diagram;
}

/**
 * Poll for video generation completion
 * @param {string} operationId - Operation ID to poll
 * @returns {Promise<{success: boolean, videoUrl?: string, error?: string}>}
 */
async function pollForVideoCompletion(operationId) {
  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    try {
      console.log(`Polling for video completion (attempt ${attempts + 1}/${MAX_POLL_ATTEMPTS})...`);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${operationId}?key=${CONFIG.VEO_API_KEY}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Polling error:', errorData);
        // Continue polling on non-fatal errors
        if (response.status !== 404) {
          attempts++;
          await sleep(POLL_INTERVAL);
          continue;
        }
        return { success: false, error: `Polling error: ${response.status}` };
      }

      const data = await response.json();

      // Check if operation is complete
      if (data.done) {
        if (data.error) {
          return {
            success: false,
            error: data.error.message || 'Video generation failed'
          };
        }

        // Extract video URL from response
        const videoUrl = extractVideoUrl(data);
        if (videoUrl) {
          console.log('Video generation complete!');
          return { success: true, videoUrl };
        }

        return { success: false, error: 'Video URL not found in response' };
      }

      // Not done yet, continue polling
      attempts++;
      await sleep(POLL_INTERVAL);
    } catch (error) {
      console.error('Polling error:', error);
      attempts++;
      await sleep(POLL_INTERVAL);
    }
  }

  return {
    success: false,
    error: 'Video generation timed out. Please try again.'
  };
}

/**
 * Extract video URL from operation response
 * @param {Object} data - Operation response
 * @returns {string|null}
 */
function extractVideoUrl(data) {
  // Try different response formats
  if (data.response?.generatedVideos?.[0]?.video?.uri) {
    return data.response.generatedVideos[0].video.uri;
  }
  if (data.result?.video?.uri) {
    return data.result.video.uri;
  }
  if (data.video?.uri) {
    return data.video.uri;
  }
  if (data.response?.video?.uri) {
    return data.response.video.uri;
  }
  return null;
}

/**
 * Sleep utility
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download video from URL and convert to blob URL
 * @param {string} videoUrl - Video URL
 * @returns {Promise<{success: boolean, blobUrl?: string, error?: string}>}
 */
export async function downloadVideo(videoUrl) {
  try {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      return { success: false, error: 'Failed to download video' };
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    return { success: true, blobUrl };
  } catch (error) {
    console.error('Video download error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Mock video generation for testing/demo
 * @returns {Promise<{success: boolean, videoUrl: string}>}
 */
export async function mockVideoGeneration() {
  console.log('Using mock video generation for demo...');
  
  // Simulate generation time (shorter for demo)
  const totalTime = 8000; // 8 seconds
  const steps = 4;
  const stepTime = totalTime / steps;

  for (let i = 1; i <= steps; i++) {
    console.log(`Mock video generation: ${i * 25}% complete`);
    await sleep(stepTime);
  }

  // Return a sample video URL (use a placeholder for demo)
  // In production, this would be a real Veo 3 generated video
  return {
    success: true,
    videoUrl: 'https://storage.googleapis.com/chrome-flow-demo/sample-summary.mp4',
    // For local testing, you can use a data URL or local file
    isDemo: true
  };
}

/**
 * Check if Veo 3 API is available
 * @returns {Promise<boolean>}
 */
export async function checkVeoAvailability() {
  try {
    // Simple health check
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${CONFIG.VEO_API_KEY}`,
      { method: 'GET' }
    );
    return response.ok;
  } catch {
    return false;
  }
}

export default {
  generateVideo,
  downloadVideo,
  mockVideoGeneration,
  checkVeoAvailability
};
