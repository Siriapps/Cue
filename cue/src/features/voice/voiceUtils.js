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
      return 'denied';
    }
  }
}

/**
 * Request microphone access
 * @returns {Promise<MediaStream>}
 */
export async function requestMicrophoneAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return stream;
  } catch (error) {
    throw new Error(`Microphone access denied: ${error.message}`);
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

