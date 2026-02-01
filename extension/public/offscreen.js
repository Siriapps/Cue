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

console.log('[cue offscreen] Offscreen document loaded and ready');
