/**
 * Audio Capture Module
 * Handles tab audio capture using Chrome's tabCapture API
 */

let mediaRecorder = null;
let audioChunks = [];
let recordingStream = null;
let recordingStartTime = null;

/**
 * Start capturing audio from the current tab
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function startAudioCapture() {
  try {
    // Check if tabCapture API is available
    if (!chrome.tabCapture) {
      return { 
        success: false, 
        error: 'Tab capture API not available. Please ensure the extension is reloaded and has tabCapture permission.' 
      };
    }

    // Check if capture method exists
    if (typeof chrome.tabCapture.capture !== 'function') {
      console.error('chrome.tabCapture.capture is not a function');
      console.log('Available methods:', Object.keys(chrome.tabCapture));
      return { 
        success: false, 
        error: 'Tab capture method not available. This may be a Manifest V3 compatibility issue.' 
      };
    }

    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.id) {
      return { success: false, error: 'No active tab found' };
    }

    console.log(`Starting audio capture on tab ${tab.id}: ${tab.url}`);

    // Request tab capture - this should work in Manifest V3
    return new Promise((resolve) => {
      try {
        chrome.tabCapture.capture(
          {
            audio: true,
            video: false
          },
          (stream) => {
            if (chrome.runtime.lastError) {
              const errorMsg = chrome.runtime.lastError.message;
              console.error('Tab capture error:', errorMsg);
              resolve({ 
                success: false, 
                error: errorMsg || 'Failed to capture tab audio. Make sure you clicked the button from a user gesture.' 
              });
              return;
            }

            if (!stream) {
              resolve({ success: false, error: 'No audio stream received from tab capture' });
              return;
            }

            setupMediaRecorder(stream);
            resolve({ success: true });
          }
        );
      } catch (error) {
        console.error('Exception calling tabCapture.capture:', error);
        resolve({ 
          success: false, 
          error: `Exception: ${error.message}. The tabCapture API may need to be called from a different context.` 
        });
      }
    });
  } catch (error) {
    console.error('Error starting audio capture:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Setup MediaRecorder with the given stream
 */
function setupMediaRecorder(stream) {
  recordingStream = stream;
  audioChunks = [];
  recordingStartTime = Date.now();

  // Create MediaRecorder with WebM format
  const options = { mimeType: 'audio/webm;codecs=opus' };
  
  try {
    mediaRecorder = new MediaRecorder(stream, options);
  } catch (e) {
    // Fallback to default format
    console.warn('WebM not supported, using default format');
    mediaRecorder = new MediaRecorder(stream);
  }

  // Handle data available
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  // Handle recording stop
  mediaRecorder.onstop = () => {
    console.log('Recording stopped, chunks collected:', audioChunks.length);
  };

  // Handle errors
  mediaRecorder.onerror = (event) => {
    console.error('MediaRecorder error:', event.error);
  };

  // Start recording with time slices for progressive capture
  mediaRecorder.start(1000); // Capture in 1-second chunks
  
  console.log('Audio capture started successfully');
}

/**
 * Stop audio capture and return the recorded audio blob
 * @returns {Promise<{success: boolean, audioBlob?: Blob, duration?: number, error?: string}>}
 */
export async function stopAudioCapture() {
  try {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return { success: false, error: 'No active recording' };
    }

    const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

    return new Promise((resolve) => {
      mediaRecorder.onstop = () => {
        // Create audio blob from chunks
        const audioBlob = new Blob(audioChunks, { 
          type: mediaRecorder.mimeType || 'audio/webm' 
        });

        console.log(`Recording stopped. Duration: ${duration}s, Size: ${audioBlob.size} bytes`);

        // Stop all tracks in the stream
        if (recordingStream) {
          recordingStream.getTracks().forEach(track => track.stop());
          recordingStream = null;
        }

        // Clean up
        audioChunks = [];
        mediaRecorder = null;
        recordingStartTime = null;

        resolve({ 
          success: true, 
          audioBlob, 
          duration,
          mimeType: audioBlob.type
        });
      };

      // Stop the recorder
      mediaRecorder.stop();
    });
  } catch (error) {
    console.error('Error stopping audio capture:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if currently recording
 * @returns {boolean}
 */
export function isRecording() {
  return mediaRecorder !== null && mediaRecorder.state === 'recording';
}

/**
 * Get current recording duration in seconds
 * @returns {number}
 */
export function getRecordingDuration() {
  if (!recordingStartTime) return 0;
  return Math.floor((Date.now() - recordingStartTime) / 1000);
}

/**
 * Convert audio blob to base64 for API transmission
 * @param {Blob} blob - Audio blob
 * @returns {Promise<string>} - Base64 encoded audio
 */
export async function blobToBase64(blob) {
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

export default {
  startAudioCapture,
  stopAudioCapture,
  isRecording,
  getRecordingDuration,
  blobToBase64
};
