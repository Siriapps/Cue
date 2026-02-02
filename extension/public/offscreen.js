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

async function startWakeWordDetection() {
  if (isListening) return;

  // Check for SpeechRecognition support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    throw new Error('Speech Recognition not available');
  }

  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offscreen.js:227',message:'Attempting getUserMedia in offscreen',data:{hasMediaDevices:!!navigator.mediaDevices},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // Request mic permission first to be sure
    // This requires the extension itself to have permission
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offscreen.js:230',message:'getUserMedia succeeded in offscreen',data:{trackCount:stream.getTracks().length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    stream.getTracks().forEach(t => t.stop()); // Release immediately
    console.log('[cue offscreen] Microphone permission granted');
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offscreen.js:234',message:'getUserMedia failed in offscreen',data:{errorName:e.name,errorMessage:e.message,errorString:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    console.error('[cue offscreen] Mic permission check failed:', e.message || e);
    // Check for specific permission errors
    const errorMsg = e.message || e.toString() || '';
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offscreen.js:238',message:'Checking error type in offscreen',data:{errorMsg,hasPermission:errorMsg.includes('permission'),hasNotAllowed:errorMsg.includes('not-allowed'),hasDeviceNotFound:errorMsg.includes('not found')||errorMsg.includes('device')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    if (errorMsg.includes('permission') || errorMsg.includes('not-allowed') || errorMsg.includes('Permission denied')) {
      // Explicitly throw a permission error string that background script checks for
      throw new Error('PERMISSION_DENIED');
    }
    // Handle device not found errors - treat as permission issue that needs user action
    if (errorMsg.includes('not found') || errorMsg.includes('device') || e.name === 'NotFoundError') {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offscreen.js:245',message:'Converting device not found to PERMISSION_DENIED',data:{errorName:e.name,errorMessage:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      // Device not found often means permission denied at system level - open permission page
      throw new Error('PERMISSION_DENIED');
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offscreen.js:251',message:'Re-throwing original error from offscreen',data:{errorName:e.name,errorMessage:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    // Re-throw other errors
    throw e;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();
      console.log('[cue offscreen] Transcript:', transcript);
      if (transcript.includes('hey cue') ||
        transcript.includes('hey q') ||
        transcript.includes('heycu') ||
        transcript.includes('hey queue') ||
        transcript.startsWith('hey cue') ||
        transcript.includes('hey, cue')) {

        console.log('[cue offscreen] Wake Word Detected!');
        wakeWordDetected = true;

        // Notify background -> content script
        chrome.runtime.sendMessage({
          type: 'WAKE_WORD_DETECTED',
          target: 'background'
        });

        // Optional: briefly stop to prevent multiple triggers
        stopWakeWordDetection();
        return;
      }
    }
  };

  recognition.onerror = (event) => {
    // console.log('[cue offscreen] Recognition error:', event.error);
    if (event.error === 'aborted' || event.error === 'not-allowed') {
      isListening = false;
      return;
    }
    // Auto-restart on other errors if supposed to be listening
    if (isListening && !isRestarting && !wakeWordDetected) {
      handleRestart();
    }
  };

  recognition.onend = () => {
    console.log('[cue offscreen] Recognition ended');
    if (isListening && !isRestarting && !wakeWordDetected) {
      handleRestart();
    }
  };

  try {
    recognition.start();
    isListening = true;
    wakeWordDetected = false;
    isRestarting = false;
    console.log('[cue offscreen] Speech recognition started');
  } catch (e) {
    console.error('[cue offscreen] Failed to start recognition:', e);
    throw e;
  }
}

function stopWakeWordDetection() {
  isListening = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) { }
    recognition = null;
  }
}

function handleRestart() {
  isRestarting = true;
  setTimeout(() => {
    if (isListening) {
      try {
        if (recognition) recognition.start();
      } catch (e) { }
    }
    isRestarting = false;
  }, 1000);
}

// Add message listeners for wake word
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_WAKE_WORD') {
    console.log('[cue offscreen] Starting wake word detection');
    startWakeWordDetection()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'STOP_WAKE_WORD') {
    console.log('[cue offscreen] Stopping wake word detection');
    stopWakeWordDetection();
    sendResponse({ success: true });
    return false;
  }
});

console.log('[cue offscreen] Offscreen document loaded and ready');
