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
    stopCaptureOnly()
      .then(() => {
        sendResponse({ success: true });
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
      const mimeType = mediaRecorder?.mimeType || 'audio/webm';
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1] || '';
        chrome.runtime.sendMessage({ type: 'AUDIO_CHUNK', chunk: base64, mimeType }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[cue offscreen] Failed to send chunk:', chrome.runtime.lastError.message);
          }
        });
      };
      reader.readAsDataURL(event.data);
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error('[cue offscreen] MediaRecorder error:', event.error);
  };

  // Record in 5-second chunks (matches Go Live CHUNK_MS)
  mediaRecorder.start(5000);
  console.log('[cue offscreen] MediaRecorder started');
}

function stopCaptureOnly() {
  return new Promise((resolve) => {
    if (!mediaRecorder) {
      resolve();
      return;
    }
    mediaRecorder.onstop = () => {
      streams.forEach(s => s.getTracks().forEach(t => t.stop()));
      streams = [];
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      mediaRecorder = null;
      audioChunks = [];
      resolve();
    };
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    } else {
      resolve();
    }
  });
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

  // Request microphone permission first to ensure it's granted
  // This helps avoid "not-allowed" errors
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Keep the stream open while recognition is active
    // Don't stop it - let SpeechRecognition use it
    micStream.getAudioTracks().forEach(track => {
      track.enabled = true;
    });
  } catch (e) {
    console.error('[cue] ❌ Microphone permission denied');
    throw new Error('Microphone permission denied: ' + e.message);
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true; // Enable interim results for faster detection
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  // Add event handlers - minimal logging
  recognition.onstart = () => {
    console.log('[cue] 🎤 Voice recognition is ON - listening for "Hey Cue"');
  };

  recognition.onaudiostart = () => {
    // Silent - audio is working
  };

  recognition.onsoundstart = () => {
    // Silent - sound detected
  };

  recognition.onspeechstart = () => {
    // Silent - speech detected
  };

  recognition.onaudioend = () => {
    // Silent
  };

  recognition.onsoundend = () => {
    // Silent
  };

  recognition.onspeechend = () => {
    // Silent
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript.toLowerCase().trim();
      
      // Log what we're hearing (temporary debug)
      if (transcript.includes('hey') || transcript.includes('cue') || transcript.includes('q')) {
        console.log('[cue] Heard:', transcript);
      }
      
      // Normalize transcript - be more permissive
      const normalized = transcript.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      
      // Check for wake word - be very permissive
      const hasHey = normalized.includes('hey') || normalized.includes('hay');
      const hasCue = normalized.includes('cue') || normalized.includes('q') || normalized.includes('queue') || normalized.includes('kyu');
      
      // Also check for combined forms (no spaces)
      const noSpaces = normalized.replace(/\s/g, '');
      const hasCombined = noSpaces.includes('heycue') || noSpaces.includes('heyq') || noSpaces.includes('haycue') || noSpaces.includes('hayq');
      
      // Check if words appear close together (within 3 words)
      const words = normalized.split(/\s+/);
      let heyIndex = -1;
      let cueIndex = -1;
      for (let j = 0; j < words.length; j++) {
        if (words[j].includes('hey') || words[j].includes('hay')) heyIndex = j;
        if (words[j].includes('cue') || words[j].includes('q') || words[j].includes('queue') || words[j].includes('kyu')) cueIndex = j;
      }
      const wordsClose = heyIndex >= 0 && cueIndex >= 0 && Math.abs(heyIndex - cueIndex) <= 3;
      
      if ((hasHey && hasCue) || hasCombined || wordsClose) {
        console.log('[cue] ✅ WAKE UP CALL DETECTED!');
        wakeWordDetected = true;

        // Notify background -> content script
        chrome.runtime.sendMessage({
          type: 'WAKE_WORD_DETECTED',
          target: 'background'
        }).catch(err => {
          console.error('[cue] Failed to send wake word message:', err);
        });

        // Stop to prevent multiple triggers
        stopWakeWordDetection();
        return;
      }
    }
  };

  recognition.onerror = (event) => {
    const error = event.error;
    
    // Handle critical errors
    if (error === 'aborted') {
      isListening = false;
      return;
    }
    
    if (error === 'not-allowed') {
      console.error('[cue] ❌ Microphone permission denied');
      isListening = false;
      return;
    }
    
    // 'no-speech' is normal - just means no speech detected yet
    if (error === 'no-speech') {
      return;
    }
    
    // Auto-restart on recoverable errors
    if (isListening && !isRestarting && !wakeWordDetected) {
      if (error !== 'aborted' && error !== 'not-allowed') {
        handleRestart(2000);
      }
    }
  };

  recognition.onend = () => {
    // SpeechRecognition ends automatically after periods of silence even with continuous=true
    // This is normal behavior - silently restart if we should still be listening
    if (isListening && !isRestarting && !wakeWordDetected) {
      handleRestart(1000);
    }
  };

  try {
    recognitionStarting = true;
    recognition.start();
    isListening = true;
    wakeWordDetected = false;
    isRestarting = false;
    recognitionStarting = false;
  } catch (e) {
    recognitionStarting = false;
    console.error('[cue] ❌ Failed to start recognition:', e.message);
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
    console.log('[cue offscreen] Skipping restart - already restarting or starting');
    return;
  }
  
  // Check if recognition is already running
  if (recognition && isListening) {
    console.log('[cue offscreen] Skipping restart - recognition is already running');
    return;
  }
  
  isRestarting = true;
  setTimeout(() => {
    if (isListening && !wakeWordDetected && !recognitionStarting) {
      console.log('[cue offscreen] Restarting recognition...');
      try {
        if (recognition) {
          // Check if recognition is already running before starting
          recognition.start();
        }
      } catch (e: any) {
        // Handle "already started" error gracefully
        const errorMsg = e.message || String(e);
        if (errorMsg.includes('already started')) {
          console.log('[cue offscreen] Recognition already started (this is okay)');
        } else if (!errorMsg.includes('not started') && !errorMsg.includes('aborted')) {
          console.warn('[cue offscreen] Restart error:', errorMsg);
        }
      }
    } else {
      console.log('[cue offscreen] Skipping restart - conditions not met:', {
        isListening,
        wakeWordDetected,
        recognitionStarting
      });
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

