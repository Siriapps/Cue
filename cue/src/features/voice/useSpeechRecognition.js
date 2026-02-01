import { useState, useEffect, useRef, useCallback } from 'react';
import { getSpeechRecognition, isSpeechRecognitionAvailable } from './voiceUtils';

/**
 * Hook for Web Speech API transcription
 * Provides continuous, real-time speech-to-text with interim results
 */
export function useSpeechRecognition(options = {}) {
  const {
    onTranscript,
    onFinalTranscript,
    onError,
    continuous = true,
    interimResults = true,
    lang = 'en-US',
    enabled = false,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef('');

  // Initialize recognition
  useEffect(() => {
    if (!isSpeechRecognitionAvailable()) {
      setError('Speech Recognition not available in this browser');
      return;
    }

    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setError('Speech Recognition constructor not found');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      finalTranscriptRef.current = '';
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        finalTranscriptRef.current += finalTranscript;
        const fullTranscript = finalTranscriptRef.current + interimTranscript;
        setTranscript(fullTranscript);
        if (onFinalTranscript) {
          onFinalTranscript(finalTranscriptRef.current.trim());
        }
      } else {
        const fullTranscript = finalTranscriptRef.current + interimTranscript;
        setTranscript(fullTranscript);
      }

      if (onTranscript) {
        onTranscript(finalTranscriptRef.current + interimTranscript);
      }
    };

    recognition.onerror = (event) => {
      const errorMessage = event.error || 'Unknown recognition error';
      setError(errorMessage);
      setIsListening(false);
      if (onError) {
        onError(event);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors when stopping
        }
        recognitionRef.current = null;
      }
    };
  }, [continuous, interimResults, lang, onTranscript, onFinalTranscript, onError]);

  // Start/stop based on enabled prop
  useEffect(() => {
    if (!recognitionRef.current) return;

    if (enabled && !isListening) {
      try {
        recognitionRef.current.start();
      } catch (error) {
        setError(`Failed to start recognition: ${error.message}`);
      }
    } else if (!enabled && isListening) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        // Ignore stop errors
      }
    }
  }, [enabled, isListening]);

  const start = useCallback(() => {
    if (!recognitionRef.current) {
      setError('Recognition not initialized');
      return;
    }
    try {
      recognitionRef.current.start();
    } catch (error) {
      setError(`Failed to start: ${error.message}`);
    }
  }, []);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch (error) {
      // Ignore stop errors
    }
  }, []);

  const reset = useCallback(() => {
    finalTranscriptRef.current = '';
    setTranscript('');
    setError(null);
  }, []);

  return {
    isListening,
    transcript,
    error,
    start,
    stop,
    reset,
    isAvailable: isSpeechRecognitionAvailable(),
  };
}

