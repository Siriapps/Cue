import { useState, useEffect, useRef, useCallback } from 'react';
import { checkMicrophonePermission, requestMicrophoneAccess, resumeAudioContext, createAudioContext } from './voiceUtils';

/**
 * Hook for wake word detection using Web Speech API keyword spotting
 */
export function useWakeWord(options = {}) {
  const {
    wakePhrase = 'Hey Cue',
    onWakeWordDetected,
    enabled = false,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  
  const fallbackRecognitionRef = useRef(null);
  const enabledRef = useRef(enabled);
  
  // Keep enabled ref in sync
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

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

        // Use Web Speech API for wake word detection
        const fallbackSuccess = initializeFallback();
        if (fallbackSuccess) {
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
      // Request permission before starting
      requestMicrophoneAccess()
        .then((stream) => {
          // Release the stream immediately - we just needed permission
          stream.getTracks().forEach(track => track.stop());
          
          if (fallbackRecognitionRef.current) {
            try {
              fallbackRecognitionRef.current.start();
              setIsListening(true);
              setError(null);
            } catch (error) {
              console.error('[voice] Failed to start wake word detection:', error);
              setError(`Failed to start wake word detection: ${error.message}`);
            }
          }
        })
        .catch((error) => {
          console.error('[voice] Microphone permission denied:', error);
          setError(`Microphone permission required: ${error.message}`);
          setIsListening(false);
        });
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
  }, [enabled, isListening, isInitialized]);


  const start = useCallback(async () => {
    if (!isInitialized) {
      setError('Wake word detection not initialized');
      return;
    }

    // Request permission if needed
    try {
      const stream = await requestMicrophoneAccess();
      // Release the stream immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      console.error('[voice] Microphone permission denied in start():', error);
      setError(`Microphone access required: ${error.message}. Please allow microphone access in your browser settings.`);
      return;
    }

    if (fallbackRecognitionRef.current && !isListening) {
      try {
        fallbackRecognitionRef.current.start();
        setIsListening(true);
        setError(null);
      } catch (error) {
        console.error('[voice] Failed to start recognition:', error);
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
  };
}

