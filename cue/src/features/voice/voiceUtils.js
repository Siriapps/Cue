/**
 * Voice Utilities - Helper functions for permissions, AudioContext, and browser compatibility
 */

/**
 * Check if Web Speech API is available
 * @returns {boolean}
 */
export function isSpeechRecognitionAvailable() {
  return (
    'SpeechRecognition' in window ||
    'webkitSpeechRecognition' in window
  );
}

/**
 * Get SpeechRecognition constructor (handles vendor prefixes)
 * @returns {SpeechRecognition|null}
 */
export function getSpeechRecognition() {
  if ('SpeechRecognition' in window) {
    return window.SpeechRecognition;
  } else if ('webkitSpeechRecognition' in window) {
    return window.webkitSpeechRecognition;
  }
  return null;
}

/**
 * Check microphone permission status
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function checkMicrophonePermission() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    return result.state;
  } catch (error) {
    // Fallback: try to request access directly
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      return 'granted';
    } catch (err) {
      // Check if it's a device not found error
      const errorMsg = err.message || err.name || '';
      if (errorMsg.includes('not found') || errorMsg.includes('device')) {
        console.warn('[voice] No microphone device found');
        return 'denied';
      }
      return 'denied';
    }
  }
}

/**
 * Enumerate available audio input devices
 * @returns {Promise<MediaDeviceInfo[]>}
 */
export async function enumerateAudioDevices() {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:60',message:'Starting enumerateAudioDevices',data:{hasMediaDevices:!!navigator.mediaDevices},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    // Try to enumerate devices directly first (may work without permission on some browsers)
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:66',message:'enumerateDevices succeeded without getUserMedia',data:{totalDevices:devices.length,audioInputCount:audioInputs.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      // If we got devices with labels, we have permission
      if (audioInputs.length > 0 && audioInputs.some(d => d.label)) {
        return audioInputs;
      }
    } catch (enumError) {
      // Enumeration failed, try getUserMedia approach
    }
    
    // Request permission first to enumerate devices with labels
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:75',message:'getUserMedia succeeded in enumerateAudioDevices',data:{trackCount:stream.getTracks().length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    stream.getTracks().forEach(track => track.stop());
    
    // Now enumerate devices (should have labels now)
    const devices = await navigator.mediaDevices.enumerateDevices();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:81',message:'enumerateDevices completed',data:{totalDevices:devices.length,audioInputCount:devices.filter(d=>d.kind==='audioinput').length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return devices.filter(device => device.kind === 'audioinput');
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:85',message:'enumerateAudioDevices failed',data:{errorName:error.name,errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.warn('[voice] Failed to enumerate devices:', error);
    // Return empty array - don't throw, let requestMicrophoneAccess handle the error
    return [];
  }
}

/**
 * Request microphone access
 * @returns {Promise<MediaStream>}
 */
export async function requestMicrophoneAccess() {
  try {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:95',message:'Starting requestMicrophoneAccess',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // Skip enumeration - it requires permission first anyway and causes "device not found" errors
    // Just try to get the stream directly, which will trigger permission prompt if needed
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:99',message:'Attempting getUserMedia directly (skipping enumeration)',data:{timestamp:Date.now()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    
    // Try with basic constraints first - this will trigger permission prompt
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: true 
      });
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:105',message:'getUserMedia succeeded with basic constraints',data:{trackCount:stream.getTracks().length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      console.log('[voice] Microphone access granted with basic constraints');
      return stream;
    } catch (basicError) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:109',message:'Basic constraints failed',data:{errorName:basicError.name,errorMessage:basicError.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      // Check error type and provide helpful message
      const errorMsg = basicError.message || basicError.name || 'Unknown error';
      
      if (errorMsg.includes('not found') || errorMsg.includes('device') || basicError.name === 'NotFoundError') {
        // On macOS, "device not found" usually means system-level permission is missing
        throw new Error('Microphone not accessible. Please check:\n1. System Settings → Privacy & Security → Microphone → Enable Chrome\n2. Ensure a microphone is connected and enabled\n3. Try restarting Chrome after granting permission');
      } else if (errorMsg.includes('permission') || errorMsg.includes('denied') || errorMsg.includes('not-allowed')) {
        throw new Error('Microphone permission denied. Please allow microphone access in your browser settings (click the lock icon in the address bar).');
      } else {
        throw new Error(`Microphone access failed: ${errorMsg}`);
      }
    }
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'voiceUtils.js:125',message:'requestMicrophoneAccess final error',data:{errorName:error.name,errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    // Re-throw our custom errors
    throw error;
  }
}

/**
 * Resume AudioContext if suspended (required for autoplay policies)
 * @param {AudioContext} audioContext
 * @returns {Promise<void>}
 */
export async function resumeAudioContext(audioContext) {
  if (audioContext && audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch (error) {
      console.error('[voice] Failed to resume AudioContext:', error);
      throw error;
    }
  }
}

/**
 * Create and configure AudioContext
 * @returns {AudioContext}
 */
export function createAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error('AudioContext not supported in this browser');
  }
  return new AudioContextClass();
}

/**
 * Check if browser supports required voice features
 * @returns {{supported: boolean, reason?: string}}
 */
export function checkBrowserSupport() {
  const checks = {
    speechRecognition: isSpeechRecognitionAvailable(),
    mediaDevices: 'mediaDevices' in navigator,
    getUserMedia: 'getUserMedia' in (navigator.mediaDevices || {}),
    audioContext: 'AudioContext' in window || 'webkitAudioContext' in window,
  };

  if (!checks.speechRecognition) {
    return { supported: false, reason: 'Web Speech API not available' };
  }
  if (!checks.mediaDevices || !checks.getUserMedia) {
    return { supported: false, reason: 'Microphone access not available' };
  }
  if (!checks.audioContext) {
    return { supported: false, reason: 'AudioContext not available' };
  }

  return { supported: true };
}

