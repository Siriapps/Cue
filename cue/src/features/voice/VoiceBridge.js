import React, { useState, useEffect, useCallback } from 'react';
import { useWakeWord } from './useWakeWord';
import { useSpeechRecognition } from './useSpeechRecognition';
import { checkMicrophonePermission, requestMicrophoneAccess, checkBrowserSupport } from './voiceUtils';

/**
 * VoiceBridge - Main component that orchestrates wake word detection and transcription
 * Bridges voice input to the parent component's query state
 */
export function VoiceBridge({ onTranscript, onListeningChange, enabled = false }) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [wakeWordDetected, setWakeWordDetected] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);

  // Check browser support
  useEffect(() => {
    const support = checkBrowserSupport();
    if (!support.supported) {
      setError(support.reason);
      return;
    }

    // Check initial permission
    checkMicrophonePermission().then((permission) => {
      if (permission === 'granted') {
        setIsInitialized(true);
        setNeedsPermission(false);
      } else {
        setNeedsPermission(true);
      }
    });
  }, []);

  // Handle wake word detection
  const handleWakeWordDetected = useCallback(() => {
    console.log('[voice] Wake word "Hey Cue" detected');
    setWakeWordDetected(true);
    setIsTranscribing(true);
  }, []);

  // Wake word detection hook
  const {
    isListening: isWakeWordListening,
    isInitialized: wakeWordInitialized,
    error: wakeWordError,
    start: startWakeWord,
    stop: stopWakeWord,
  } = useWakeWord({
    wakePhrase: 'Hey Cue',
    onWakeWordDetected: handleWakeWordDetected,
    enabled: enabled && isInitialized && !needsPermission,
  });

  // Speech recognition hook (activated after wake word)
  const {
    isListening: isRecognitionListening,
    transcript,
    error: recognitionError,
    start: startRecognition,
    stop: stopRecognition,
    reset: resetTranscript,
  } = useSpeechRecognition({
    onTranscript: (text) => {
      if (onTranscript) {
        onTranscript(text);
      }
    },
    onFinalTranscript: (text) => {
      if (onTranscript) {
        onTranscript(text);
      }
    },
    enabled: isTranscribing && wakeWordDetected,
    continuous: true,
    interimResults: true,
  });

  // Start transcription when wake word detected
  useEffect(() => {
    if (wakeWordDetected && !isRecognitionListening) {
      startRecognition();
    }
  }, [wakeWordDetected, isRecognitionListening, startRecognition]);

  // Update parent about listening state
  useEffect(() => {
    if (onListeningChange) {
      onListeningChange(isWakeWordListening || isRecognitionListening);
    }
  }, [isWakeWordListening, isRecognitionListening, onListeningChange]);

  // Handle errors
  useEffect(() => {
    if (wakeWordError) {
      setError(wakeWordError);
    } else if (recognitionError) {
      setError(recognitionError);
    } else {
      setError(null);
    }
  }, [wakeWordError, recognitionError]);

  // Request microphone permission
  const handleRequestPermission = useCallback(async () => {
    try {
      await requestMicrophoneAccess();
      setIsInitialized(true);
      setNeedsPermission(false);
      setError(null);
    } catch (error) {
      setError(`Permission denied: ${error.message}`);
    }
  }, []);

  // Manual start (for mic button)
  const handleManualStart = useCallback(async () => {
    if (needsPermission) {
      await handleRequestPermission();
      return;
    }

    if (!isInitialized) {
      setError('Voice system not initialized');
      return;
    }

    setWakeWordDetected(true);
    setIsTranscribing(true);
    startRecognition();
  }, [needsPermission, isInitialized, handleRequestPermission, startRecognition]);

  // Stop transcription
  const handleStop = useCallback(() => {
    stopRecognition();
    setIsTranscribing(false);
    setWakeWordDetected(false);
    resetTranscript();
  }, [stopRecognition, resetTranscript]);

  // Reset state
  const handleReset = useCallback(() => {
    handleStop();
    setError(null);
  }, [handleStop]);

  // Expose control methods via ref (if needed)
  // For now, we'll use the returned object

  return {
    // State
    isListening: isWakeWordListening || isRecognitionListening,
    isTranscribing,
    wakeWordDetected,
    needsPermission,
    isInitialized,
    error,
    transcript,

    // Controls
    start: handleManualStart,
    stop: handleStop,
    reset: handleReset,
    requestPermission: handleRequestPermission,
  };
}

/**
 * Hook version of VoiceBridge for easier integration
 */
export function useVoiceBridge(onTranscript, enabled = false) {
  const [isListening, setIsListening] = useState(false);
  const bridgeRef = React.useRef(null);

  const handleTranscript = useCallback(
    (text) => {
      if (onTranscript) {
        onTranscript(text);
      }
    },
    [onTranscript]
  );

  const handleListeningChange = useCallback((listening) => {
    setIsListening(listening);
  }, []);

  // This is a simplified version - in practice, we'll use the hooks directly
  const wakeWord = useWakeWord({
    wakePhrase: 'Hey Cue',
    onWakeWordDetected: () => {
      // Trigger transcription
    },
    enabled: enabled && !bridgeRef.current?.needsPermission,
  });

  const recognition = useSpeechRecognition({
    onTranscript: handleTranscript,
    enabled: false, // Controlled by wake word
    continuous: true,
    interimResults: true,
  });

  return {
    isListening,
    start: () => {},
    stop: () => {},
    requestPermission: async () => {},
    needsPermission: false,
    error: null,
  };
}

