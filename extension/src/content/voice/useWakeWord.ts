import { useState, useEffect, useRef, useCallback } from 'react';
import { getSpeechRecognition, isSpeechRecognitionAvailable } from './voiceUtils';

interface UseWakeWordOptions {
    onWakeWordDetected?: () => void;
    enabled?: boolean;
}

/**
 * Hook for wake word detection - runs directly in content script
 * SpeechRecognition doesn't work in offscreen documents, so we run it here
 */
export function useWakeWord(options: UseWakeWordOptions = {}) {
    const {
        onWakeWordDetected,
        enabled = false,
    } = options;

    const [isListening, setIsListening] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onWakeWordDetectedRef = useRef(onWakeWordDetected);
    const recognitionRef = useRef<any>(null);
    const isRestartingRef = useRef(false);
    const wakeWordDetectedRef = useRef(false);
    // Keep a minimal mic stream open in content script to show tab indicator
    const indicatorStreamRef = useRef<MediaStream | null>(null);

    // Keep refs in sync
    useEffect(() => {
        onWakeWordDetectedRef.current = onWakeWordDetected;
    }, [onWakeWordDetected]);

    // Handle messages from background
    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.type === 'WAKE_WORD_DETECTED') {
                console.log('[cue] 🎤 Wake up call detected signal received');
                if (onWakeWordDetectedRef.current) {
                    onWakeWordDetectedRef.current();
                }
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);
        return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, []);

    // Initialize SpeechRecognition
    useEffect(() => {
        if (!isSpeechRecognitionAvailable()) {
            setError('Speech Recognition not available in this browser');
            setIsInitialized(false);
            return;
        }

        const SpeechRecognition = getSpeechRecognition();
        if (!SpeechRecognition) {
            setError('Speech Recognition constructor not found');
            setIsInitialized(false);
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log('[voice] ✅ Wake word recognition started');
            setIsListening(true);
            setError(null);
        };

        recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript.toLowerCase().trim();
                const isFinal = result.isFinal;
                
                // Log transcripts that might be wake words
                if (transcript.includes('hey') || transcript.includes('cue') || transcript.includes('q')) {
                    console.log(`[voice] ${isFinal ? 'Final' : 'Interim'} transcript: "${transcript}"`);
                }
                
                // Check for wake word
                const hasHey = transcript.includes('hey');
                const hasCue = transcript.includes('cue') || transcript.includes('q') || transcript.includes('queue');
                const hasCombined = transcript.includes('heycue') || transcript.includes('heyq') || transcript.includes('hey queue');
                
                if ((hasHey && hasCue) || hasCombined) {
                    console.log('[voice] 🎤 Wake up call detected! Transcript:', transcript);
                    wakeWordDetectedRef.current = true;
                    
                    // Stop recognition
                    try {
                        recognition.stop();
                    } catch (e) {}
                    
                    // Notify callback
                    if (onWakeWordDetectedRef.current) {
                        onWakeWordDetectedRef.current();
                    }
                    return;
                }
            }
        };

        recognition.onerror = (event: any) => {
            const error = event.error;
            
            if (error === 'aborted' || error === 'not-allowed') {
                console.warn('[voice] Recognition error:', error);
                setIsListening(false);
                return;
            }
            
            if (error === 'no-speech') {
                // Normal - just means no speech detected yet
                return;
            }
            
            console.warn('[voice] Recognition error:', error);
            
            // Auto-restart on recoverable errors
            if (isListening && !isRestartingRef.current && !wakeWordDetectedRef.current) {
                if (error !== 'aborted' && error !== 'not-allowed') {
                    isRestartingRef.current = true;
                    setTimeout(() => {
                        if (isListening && recognitionRef.current) {
                            try {
                                recognitionRef.current.start();
                            } catch (e) {}
                        }
                        isRestartingRef.current = false;
                    }, 1000);
                }
            }
        };

        recognition.onend = () => {
            setIsListening(false);
            // Auto-restart if supposed to be listening
            if (enabled && !wakeWordDetectedRef.current && !isRestartingRef.current) {
                isRestartingRef.current = true;
                setTimeout(() => {
                    if (enabled && recognitionRef.current && !wakeWordDetectedRef.current) {
                        try {
                            recognitionRef.current.start();
                        } catch (e) {}
                    }
                    isRestartingRef.current = false;
                }, 500);
            }
        };

        recognitionRef.current = recognition;
        setIsInitialized(true);

        return () => {
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.stop();
                } catch (e) {}
                recognitionRef.current = null;
            }
        };
    }, [enabled]);

    const start = useCallback(async () => {
        if (!isInitialized || !recognitionRef.current) {
            console.warn('[voice] Cannot start - not initialized');
            return;
        }

        console.log('[voice] Starting wake word detection...');
        wakeWordDetectedRef.current = false;
        
        // Request mic access in content script to show tab indicator
        try {
            if (!indicatorStreamRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                indicatorStreamRef.current = stream;
                stream.getAudioTracks().forEach(track => {
                    track.enabled = true; // Keep enabled to show indicator
                });
            }
        } catch (e: any) {
            console.warn('[voice] Failed to get mic stream for indicator:', e.message);
            // Continue anyway - recognition will still work
        }

        // Start recognition directly
        try {
            recognitionRef.current.start();
            console.log('[voice] Wake word detection started');
        } catch (e: any) {
            console.error('[voice] Failed to start recognition:', e);
            setError(e.message || 'Failed to start recognition');
            setIsListening(false);
        }
    }, [isInitialized]);

    const stop = useCallback(() => {
        console.log('[voice] Stopping wake word detection...');
        
        // Stop recognition
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (e) {
                // Ignore errors
            }
        }
        
        // Stop the indicator stream to hide tab indicator
        if (indicatorStreamRef.current) {
            indicatorStreamRef.current.getTracks().forEach(track => track.stop());
            indicatorStreamRef.current = null;
        }
        
        setIsListening(false);
        wakeWordDetectedRef.current = false;
    }, []);

    // Sync enabled state
    useEffect(() => {
        if (!isInitialized) return;

        if (enabled && !isListening) {
            start();
        } else if (!enabled && isListening) {
            stop();
        }
    }, [enabled, isInitialized, start, stop, isListening]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (indicatorStreamRef.current) {
                indicatorStreamRef.current.getTracks().forEach(track => track.stop());
                indicatorStreamRef.current = null;
            }
        };
    }, []);

    return {
        isListening,
        isInitialized,
        error,
        start,
        stop
    };
}
