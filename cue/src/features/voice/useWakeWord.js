import { useState, useEffect, useRef, useCallback } from 'react';
import { checkMicrophonePermission, requestMicrophoneAccess, resumeAudioContext, createAudioContext } from './voiceUtils';

/**
 * Hook for wake word detection using Porcupine (with fallback to Web Speech API keyword spotting)
 */
export function useWakeWord(options = {}) {
  const {
    wakePhrase = 'Hey Cue',
    onWakeWordDetected,
    enabled = false,
    porcupineAccessKey = null, // User must provide from Picovoice Console
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [usePorcupine, setUsePorcupine] = useState(false);
  
  const porcupineRef = useRef(null);
  const audioContextRef = useRef(null);
  const fallbackRecognitionRef = useRef(null);
  const workerRef = useRef(null);
  const enabledRef = useRef(enabled);
  
  // Keep enabled ref in sync
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Initialize Porcupine
  const initializePorcupine = useCallback(async () => {
    if (!porcupineAccessKey) {
      console.warn('[voice] Porcupine AccessKey not provided, using fallback');
      return false;
    }

    try {
      // Dynamic import to avoid bundle size if not used
      const { Porcupine } = await import('@picovoice/porcupine-web');
      const { WebVoiceProcessor } = await import('@picovoice/web-voice-processor');

      // Create custom keyword for "Hey Cue"
      // Note: Porcupine requires a keyword model file. For "Hey Cue", we'll use a built-in
      // or create a custom one. For now, we'll use a fallback approach.
      
      // Check if we can use Porcupine's built-in keywords or need custom model
      // Since "Hey Cue" is not a built-in, we'll use fallback for now
      // In production, you'd need to generate a custom keyword model via Picovoice Console
      
      console.log('[voice] Porcupine initialization skipped - custom keyword model required');
      return false;
    } catch (error) {
      console.warn('[voice] Porcupine initialization failed:', error);
      return false;
    }
  }, [porcupineAccessKey]);

  // Fallback: Use Web Speech API with keyword grammar
  const initializeFallback = useCallback(() => {
    if (!('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      setError('Speech Recognition not available for wake word detection');
      return false;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        // Simple keyword matching for "hey cue"
        if (transcript.includes('hey cue') || transcript.includes('hey q')) {
          if (onWakeWordDetected) {
            onWakeWordDetected();
          }
        }
      }
    };

    recognition.onerror = (event) => {
      console.error('[voice] Wake word recognition error:', event.error);
      setError(`Wake word detection error: ${event.error}`);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Auto-restart if still enabled
      if (enabledRef.current && fallbackRecognitionRef.current) {
        setTimeout(() => {
          if (enabledRef.current && fallbackRecognitionRef.current) {
            try {
              fallbackRecognitionRef.current.start();
            } catch (e) {
              // Ignore restart errors (might already be starting)
            }
          }
        }, 100);
      }
    };

    fallbackRecognitionRef.current = recognition;
    return true;
  }, [onWakeWordDetected]);

  // Initialize wake word detection
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        // Check microphone permission
        const permission = await checkMicrophonePermission();
        if (permission === 'denied') {
          setError('Microphone permission denied');
          return;
        }

        // Try Porcupine first
        const porcupineSuccess = await initializePorcupine();
        if (porcupineSuccess) {
          setUsePorcupine(true);
          setIsInitialized(true);
          if (mounted) setIsListening(enabled);
          return;
        }

        // Fallback to Web Speech API
        const fallbackSuccess = initializeFallback();
        if (fallbackSuccess) {
          setUsePorcupine(false);
          setIsInitialized(true);
          if (mounted) setIsListening(enabled);
        } else {
          setError('Failed to initialize wake word detection');
        }
      } catch (err) {
        console.error('[voice] Wake word initialization error:', err);
        setError(err.message);
      }
    };

    init();

    return () => {
      mounted = false;
      if (fallbackRecognitionRef.current) {
        try {
          fallbackRecognitionRef.current.stop();
        } catch (e) {
          // Ignore
        }
        fallbackRecognitionRef.current = null;
      }
    };
  }, []); // Only run once on mount

  // Start/stop based on enabled prop
  useEffect(() => {
    if (!isInitialized) return;

    if (enabled && !isListening) {
      if (usePorcupine && porcupineRef.current) {
        // Porcupine start logic
        setIsListening(true);
      } else if (fallbackRecognitionRef.current) {
        try {
          fallbackRecognitionRef.current.start();
          setIsListening(true);
        } catch (error) {
          setError(`Failed to start wake word detection: ${error.message}`);
        }
      }
    } else if (!enabled && isListening) {
      if (fallbackRecognitionRef.current) {
        try {
          fallbackRecognitionRef.current.stop();
        } catch (e) {
          // Ignore
        }
        setIsListening(false);
      }
    }
  }, [enabled, isListening, isInitialized, usePorcupine]);


  const start = useCallback(async () => {
    if (!isInitialized) {
      setError('Wake word detection not initialized');
      return;
    }

    // Request permission if needed
    try {
      await requestMicrophoneAccess();
    } catch (error) {
      setError(`Microphone access required: ${error.message}`);
      return;
    }

    if (fallbackRecognitionRef.current && !isListening) {
      try {
        fallbackRecognitionRef.current.start();
        setIsListening(true);
      } catch (error) {
        setError(`Failed to start: ${error.message}`);
      }
    }
  }, [isInitialized, isListening]);

  const stop = useCallback(() => {
    if (fallbackRecognitionRef.current && isListening) {
      try {
        fallbackRecognitionRef.current.stop();
        setIsListening(false);
      } catch (error) {
        // Ignore stop errors
      }
    }
  }, [isListening]);

  return {
    isListening,
    isInitialized,
    error,
    start,
    stop,
    usePorcupine,
  };
}

