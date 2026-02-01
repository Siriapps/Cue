/**
 * Voice Utilities - Helper functions for permissions, AudioContext, and browser compatibility
 */

/**
 * Check if Web Speech API is available
 * @returns {boolean}
 */
export function isSpeechRecognitionAvailable(): boolean {
  return (
    'SpeechRecognition' in window ||
    'webkitSpeechRecognition' in window
  );
}

/**
 * Get SpeechRecognition constructor (handles vendor prefixes)
 * @returns {SpeechRecognition | null}
 */
export function getSpeechRecognition(): any {
  if ('SpeechRecognition' in window) {
    return (window as any).SpeechRecognition;
  } else if ('webkitSpeechRecognition' in window) {
    return (window as any).webkitSpeechRecognition;
  }
  return null;
}

/**
 * Request microphone access
 * @returns {Promise<MediaStream>}
 */
export async function requestMicrophoneAccess(): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return stream;
  } catch (error: any) {
    const errorMsg = error.message || error.name || 'Unknown error';
    if (errorMsg.includes('not found') || errorMsg.includes('device') || error.name === 'NotFoundError') {
      throw new Error('Microphone not accessible. Please check:\n1. System Settings → Privacy & Security → Microphone → Enable Chrome\n2. Ensure a microphone is connected and enabled\n3. Try restarting Chrome after granting permission');
    } else if (errorMsg.includes('permission') || errorMsg.includes('denied') || errorMsg.includes('not-allowed')) {
      throw new Error('Microphone permission denied. Please allow microphone access in your browser settings (click the lock icon in the address bar).');
    } else {
      throw new Error(`Microphone access failed: ${errorMsg}`);
    }
  }
}
