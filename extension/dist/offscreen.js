/**
 * Offscreen document for tab audio capture (MV3 requirement)
 * chrome.tabCapture.capture() can only be called from offscreen documents in MV3
 */

let mediaRecorder = null;
let audioChunks = [];
let audioContext = null;
let streams = [];

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages targeted at offscreen document
  if (message.target !== 'offscreen') return false;

  if (message.type === 'START_CAPTURE') {
    console.log('[cue offscreen] Starting capture with streamId:', message.streamId);
    startCapture(message.streamId, message.includeMic)
      .then(() => {
        console.log('[cue offscreen] Capture started successfully');
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[cue offscreen] Capture failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }

  if (message.type === 'STOP_CAPTURE') {
    console.log('[cue offscreen] Stopping capture');
    stopCapture()
      .then(audioBase64 => {
        console.log('[cue offscreen] Capture stopped, audio size:', audioBase64.length, 'base64 chars');
        sendResponse({ success: true, audioBase64, mimeType: 'audio/webm' });
      })
      .catch(err => {
        console.error('[cue offscreen] Stop capture failed:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep channel open for async response
  }

  return false;
});

async function startCapture(streamId, includeMic) {
  if (mediaRecorder) {
    console.warn('[cue offscreen] Recording already in progress');
    return;
  }

  if (!streamId) {
    throw new Error('No streamId provided');
  }

  // Get tab audio stream using the streamId from tabCapture.getMediaStreamId()
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  console.log('[cue offscreen] Tab audio stream acquired via streamId');
  streams = [tabStream];
  let finalStream = tabStream;

  // Optionally add microphone audio
  if (includeMic) {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      console.log('[cue offscreen] Microphone stream acquired');
      streams.push(micStream);

      // Mix tab audio and microphone using AudioContext
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();

      // Connect tab audio to destination
      const tabSource = audioContext.createMediaStreamSource(tabStream);
      tabSource.connect(destination);

      // Connect mic audio to destination
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

      finalStream = destination.stream;
      console.log('[cue offscreen] Audio streams mixed (tab + mic)');
    } catch (e) {
      console.warn('[cue offscreen] Mic capture failed, using tab audio only:', e.message);
      // Continue with tab audio only
    }
  }

  // Set up MediaRecorder
  audioChunks = [];
  const options = { mimeType: 'audio/webm;codecs=opus' };

  try {
    mediaRecorder = new MediaRecorder(finalStream, options);
  } catch (e) {
    console.warn('[cue offscreen] WebM codec not supported, using default:', e.message);
    mediaRecorder = new MediaRecorder(finalStream);
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      audioChunks.push(event.data);
      console.log('[cue offscreen] Audio chunk received, size:', event.data.size);
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error('[cue offscreen] MediaRecorder error:', event.error);
  };

  // Record in 10-second chunks
  mediaRecorder.start(10000);
  console.log('[cue offscreen] MediaRecorder started');
}

async function stopCapture() {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      console.warn('[cue offscreen] No active recording to stop');
      resolve('');
      return;
    }

    mediaRecorder.onstop = async () => {
      try {
        // Create blob from collected chunks
        const blob = new Blob(audioChunks, {
          type: mediaRecorder?.mimeType || 'audio/webm'
        });
        console.log('[cue offscreen] Audio blob created, size:', blob.size);

        // Cleanup streams
        streams.forEach(stream => {
          stream.getTracks().forEach(track => {
            track.stop();
            console.log('[cue offscreen] Track stopped:', track.kind);
          });
        });
        streams = [];

        // Cleanup AudioContext
        if (audioContext) {
          await audioContext.close();
          audioContext = null;
        }

        // Reset state
        mediaRecorder = null;
        audioChunks = [];

        // Convert blob to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result;
          const base64 = dataUrl.split(',')[1] || '';
          resolve(base64);
        };
        reader.onerror = () => {
          reject(new Error('Failed to read audio blob'));
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    };

    // Stop the recorder
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      // Already stopped, return what we have
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      streams.forEach(s => s.getTracks().forEach(t => t.stop()));
      streams = [];
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      mediaRecorder = null;
      audioChunks = [];

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1] || '';
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    }
  });
}

// ================== WAKE WORD DETECTION ==================

let recognition = null;
let isListening = false;
let isRestarting = false;
let wakeWordDetected = false;
let recognitionStarting = false; // Track if recognition is in the process of starting
let micStream = null; // Keep mic stream open while recognition is active

async function startWakeWordDetection() {
  console.log('[cue offscreen] startWakeWordDetection called, isListening:', isListening);
  
  if (isListening) {
    console.log('[cue offscreen] Already listening, skipping');
    return;
  }

  // Check for SpeechRecognition support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  console.log('[cue offscreen] SpeechRecognition check:', !!SpeechRecognition);
  
  if (!SpeechRecognition) {
    console.error('[cue offscreen] Speech Recognition not available');
    throw new Error('Speech Recognition not available');
  }

  // Don't request getUserMedia - let SpeechRecognition handle microphone access directly
  // SpeechRecognition API manages its own microphone access and doesn't need getUserMedia
  // Requesting getUserMedia first can cause conflicts and "not-allowed" errors
  console.log('[cue offscreen] Skipping getUserMedia - SpeechRecognition will handle mic access');

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true; // Enable interim results for faster detection
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  // Add event handlers for debugging
  recognition.onstart = () => {
    console.log('[cue offscreen] ✅ Recognition.onstart fired - microphone should be active now');
  };

  recognition.onaudiostart = () => {
    console.log('[cue offscreen] 🎤 Audio capture started - microphone is receiving audio');
  };

  recognition.onsoundstart = () => {
    console.log('[cue offscreen] 🔊 Sound detected - audio input detected');
  };

  recognition.onspeechstart = () => {
    console.log('[cue offscreen] 🗣️ Speech detected - speech recognition is processing');
  };

  recognition.onaudioend = () => {
    console.log('[cue offscreen] ⚠️ Audio capture ended');
  };

  recognition.onsoundend = () => {
    console.log('[cue offscreen] ⚠️ Sound ended');
  };

  recognition.onspeechend = () => {
    console.log('[cue offscreen] ⚠️ Speech ended');
  };

  recognition.onresult = (event) => {
    console.log('[cue offscreen] onresult fired, resultIndex:', event.resultIndex, 'results.length:', event.results.length);
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript.toLowerCase().trim();
      const isFinal = result.isFinal;
      const confidence = result[0].confidence || 'N/A';
      
      // Log all transcripts for debugging
      console.log(`[cue offscreen] ${isFinal ? 'Final' : 'Interim'} transcript: "${transcript}" (confidence: ${confidence})`);
      
      // Very simple and permissive matching - just check if both words appear
      const hasHey = transcript.includes('hey');
      const hasCue = transcript.includes('cue') || transcript.includes('q') || transcript.includes('queue');
      
      // Also check for combined forms
      const hasCombined = transcript.includes('heycue') || transcript.includes('heyq') || transcript.includes('hey queue');
      
      if ((hasHey && hasCue) || hasCombined) {
        console.log('[cue] 🎤 Wake up call detected! Transcript:', transcript);
        wakeWordDetected = true;

        // Notify background -> content script
        chrome.runtime.sendMessage({
          type: 'WAKE_WORD_DETECTED',
          target: 'background'
        }).catch(err => {
          // Ignore errors if background script is unavailable
          console.warn('[cue offscreen] Failed to send wake word message:', err);
        });

        // Stop to prevent multiple triggers
        stopWakeWordDetection();
        return;
      }
    }
  };

  recognition.onerror = (event) => {
    const error = event.error;
    
    // Handle critical errors that should stop listening
    if (error === 'aborted') {
      console.warn('[cue offscreen] Recognition aborted');
      isListening = false;
      return;
    }
    
    if (error === 'not-allowed') {
      console.error('[cue offscreen] ❌ Recognition error: not-allowed');
      console.error('[cue offscreen] SpeechRecognition API permission denied');
      console.error('[cue offscreen] This may require user interaction or system permissions');
      
      // Try to restart after a delay - sometimes it works on retry
      if (isListening && !isRestarting) {
        console.log('[cue offscreen] Will attempt restart in 2 seconds...');
        setTimeout(() => {
          if (isListening && !wakeWordDetected) {
            console.log('[cue offscreen] Retrying wake word detection...');
            handleRestart(2000);
          }
        }, 2000);
      }
      
      isListening = false;
      return;
    }
    
    // 'no-speech' is normal - just means no speech detected yet
    if (error === 'no-speech') {
      // Don't log this - it's expected when waiting for wake word
      return;
    }
    
    // Log other errors for debugging
    console.warn('[cue offscreen] Recognition error:', error);
    
    // Auto-restart on recoverable errors if supposed to be listening
    if (isListening && !isRestarting && !wakeWordDetected) {
      // Restart on most errors except critical ones
      if (error !== 'aborted' && error !== 'not-allowed') {
        handleRestart(500); // Faster restart
      }
    }
  };

  recognition.onend = () => {
    console.log('[cue offscreen] ⚠️ Recognition ended. isListening:', isListening, 'isRestarting:', isRestarting, 'wakeWordDetected:', wakeWordDetected);
    // SpeechRecognition ends automatically after periods of silence even with continuous=true
    // This is normal behavior - silently restart if we should still be listening
    if (isListening && !isRestarting && !wakeWordDetected) {
      console.log('[cue offscreen] Auto-restarting recognition in 500ms...');
      // Use a shorter delay for normal restarts
      handleRestart(500);
    } else if (!isListening) {
      // Only log if we're not supposed to be listening (unexpected end)
      console.log('[cue offscreen] Recognition ended (expected - not listening)');
    } else if (wakeWordDetected) {
      console.log('[cue offscreen] Recognition ended (wake word was detected)');
    }
  };

  try {
    recognitionStarting = true;
    console.log('[cue offscreen] Attempting to start recognition...');
    recognition.start();
    isListening = true;
    wakeWordDetected = false;
    isRestarting = false;
    recognitionStarting = false;
    console.log('[cue offscreen] ✅ Speech recognition started - listening for "Hey Cue"');
    console.log('[cue offscreen] Recognition config - continuous:', recognition.continuous, 'interimResults:', recognition.interimResults, 'lang:', recognition.lang);
  } catch (e) {
    recognitionStarting = false;
    console.error('[cue offscreen] ❌ Failed to start recognition:', e);
    console.error('[cue offscreen] Error details:', e.message, e.name);
    isListening = false;
    throw e;
  }
}

function stopWakeWordDetection() {
  isListening = false;
  recognitionStarting = false;
  isRestarting = false;
  
  // Stop recognition
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) { 
      // Ignore stop errors
    }
    recognition = null;
  }
  
  // Stop and release microphone stream
  if (micStream) {
    console.log('[cue offscreen] Stopping microphone stream...');
    micStream.getTracks().forEach(track => {
      track.stop();
      console.log('[cue offscreen] Mic track stopped:', track.kind);
    });
    micStream = null;
  }
}

function handleRestart(delay = 1000) {
  if (isRestarting || recognitionStarting) {
    // Already restarting or starting, skip
    return;
  }
  
  isRestarting = true;
  setTimeout(() => {
    if (isListening && recognition && !recognitionStarting) {
      try {
        recognition.start();
      } catch (e) {
        // Ignore errors if recognition is already started or stopped
        const errorMsg = e.message || String(e);
        if (!errorMsg.includes('already started') && !errorMsg.includes('not started') && !errorMsg.includes('aborted')) {
          console.warn('[cue offscreen] Restart error:', errorMsg);
        }
      }
    }
    isRestarting = false;
  }, delay);
}

// Add message listeners for wake word - MUST be at top level, not inside any function
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages explicitly targeted at offscreen
  // Ignore all other messages (like ASK_AI which should go to background)
  if (message.target !== 'offscreen') {
    return false; // Don't log - this is expected for most messages
  }

  console.log('[cue offscreen] Message received:', message.type, 'target:', message.target);

  if (message.type === 'START_WAKE_WORD') {
    console.log('[cue offscreen] START_WAKE_WORD received, isListening:', isListening);
    
    // Start wake word detection
    startWakeWordDetection()
      .then(() => {
        console.log('[cue offscreen] Wake word detection started successfully');
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[cue offscreen] Failed to start wake word detection:', err);
        sendResponse({ success: false, error: err.message });
      });
    
    // Return true to indicate we will send response asynchronously
    return true;
  }

  if (message.type === 'STOP_WAKE_WORD') {
    console.log('[cue offscreen] Stopping wake word detection');
    stopWakeWordDetection();
    sendResponse({ success: true });
    return false;
  }
  
  return false;
});

// Helper to forward logs to background script so they appear in main console
function logToBackground(level, ...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  chrome.runtime.sendMessage({
    type: 'OFFSCREEN_LOG',
    level,
    message: `[offscreen] ${message}`
  }).catch(() => {}); // Ignore errors
}

// Override console methods to forward to background
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args) => {
  originalLog.apply(console, args);
  logToBackground('log', ...args);
};

console.error = (...args) => {
  originalError.apply(console, args);
  logToBackground('error', ...args);
};

console.warn = (...args) => {
  originalWarn.apply(console, args);
  logToBackground('warn', ...args);
};

console.log('[cue offscreen] Offscreen document loaded and ready');
console.log('[cue offscreen] SpeechRecognition available:', !!(window.SpeechRecognition || window.webkitSpeechRecognition));
console.log('[cue offscreen] navigator.mediaDevices available:', !!navigator.mediaDevices);

