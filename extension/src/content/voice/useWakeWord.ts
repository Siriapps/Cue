import { useState, useEffect, useRef, useCallback } from 'react';
import { getSpeechRecognition, isSpeechRecognitionAvailable } from './voiceUtils';

interface UseWakeWordOptions {
    onWakeWordDetected?: () => void;
    enabled?: boolean;
}

/**
 * Hook for wake word detection
 * Uses content script for most sites, falls back to offscreen document for CSP-restricted sites
 */
export function useWakeWord(options: UseWakeWordOptions = {}) {
    const {
        onWakeWordDetected,
        enabled = false,
    } = options;

    const [isListening, setIsListening] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [useOffscreen, setUseOffscreen] = useState(false);

    const onWakeWordDetectedRef = useRef(onWakeWordDetected);
    const recognitionRef = useRef<any>(null);
    const isRestartingRef = useRef(false);
    const wakeWordDetectedRef = useRef(false);
    // Keep a minimal mic stream open in content script to show tab indicator
    const indicatorStreamRef = useRef<MediaStream | null>(null);

    // Check if site has CSP restrictions (like YouTube, Google Docs)
    const checkCSPRestrictions = useCallback(() => {
        const hostname = window.location.hostname;
        // Sites known to block SpeechRecognition via CSP
        const cspRestrictedSites = [
            'youtube.com',
            'www.youtube.com',
            'youtu.be',
            'docs.google.com',
            'sheets.google.com',
            'drive.google.com',
            'meet.google.com'
        ];
        
        const isRestricted = cspRestrictedSites.some(site => hostname.includes(site));
        if (isRestricted) {
            console.log('[voice] Site has CSP restrictions, will use offscreen document:', hostname);
            return true;
        }
        return false;
    }, []);

    // Check if site is localhost or Google domain (for proactive permission request)
    const isLocalhostOrGoogle = useCallback(() => {
        const hostname = window.location.hostname;
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
        const isGoogle = hostname.includes('google.com') || hostname.includes('youtube.com') || hostname.includes('gmail.com');
        return isLocalhost || isGoogle;
    }, []);

    // Proactively request microphone permission for localhost and Google domains
    const requestPermissionIfNeeded = useCallback(async () => {
        if (!isLocalhostOrGoogle()) {
            return;
        }

        const hostname = window.location.hostname;
        console.log('[voice] Proactively requesting microphone permission for:', hostname);
        
        try {
            // Request permission early to ensure it's granted
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Keep the stream open briefly to ensure permission is registered
            setTimeout(() => {
                stream.getTracks().forEach(track => track.stop());
            }, 100);
            console.log('[voice] ✅ Microphone permission granted for:', hostname);
        } catch (e: any) {
            console.warn('[voice] Could not pre-grant permission for:', hostname, e.message);
            // Don't throw - permission will be requested when needed
        }
    }, [isLocalhostOrGoogle]);

    // Keep refs in sync
    useEffect(() => {
        onWakeWordDetectedRef.current = onWakeWordDetected;
    }, [onWakeWordDetected]);

    // Handle messages from background (for offscreen document approach)
    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.type === 'WAKE_WORD_DETECTED') {
                if (onWakeWordDetectedRef.current) {
                    onWakeWordDetectedRef.current();
                }
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);
        return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, []);

    // Proactively request permissions for localhost and Google domains
    useEffect(() => {
        if (isLocalhostOrGoogle()) {
            requestPermissionIfNeeded();
        }
    }, [isLocalhostOrGoogle, requestPermissionIfNeeded]);

    // Initialize - check if we should use offscreen document
    useEffect(() => {
        const shouldUseOffscreen = checkCSPRestrictions();
        if (shouldUseOffscreen) {
            setUseOffscreen(true);
            setIsInitialized(true); // Mark as initialized so we can start
            console.log('[voice] Using offscreen document for wake word detection (CSP restrictions)');
            // Don't initialize SpeechRecognition in content script when using offscreen
            return;
        }
        
        // Use content script approach for other sites
        // Only initialize SpeechRecognition if NOT using offscreen
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const isGoogleDomain = hostname.includes('google.com') || hostname.includes('youtube.com');
        
        // Check if SpeechRecognition is available
        const isAvailable = isSpeechRecognitionAvailable();
        
        if (!isAvailable) {
            console.error('[voice] Speech Recognition not available in this browser on:', hostname);
            setError('Speech Recognition not available in this browser');
            setIsInitialized(false);
            return;
        }

        const SpeechRecognition = getSpeechRecognition();
        if (!SpeechRecognition) {
            console.error('[voice] Speech Recognition constructor not found on:', hostname);
            setError('Speech Recognition constructor not found');
            setIsInitialized(false);
            return;
        }
        
        // Create SpeechRecognition instance
        setUseOffscreen(false);

        try {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            recognition.maxAlternatives = 1;

            recognition.onstart = () => {
                console.log('[cue] 🎤 Voice recognition is ON - listening for "Hey Cue"');
                setIsListening(true);
                setError(null);
            };

        recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                const transcript = result[0].transcript.toLowerCase().trim();
                
                // Log what we're hearing (temporary debug)
                if (transcript.includes('hey') || transcript.includes('cue') || transcript.includes('q')) {
                    console.log('[cue] Heard:', transcript);
                }
                
                // Normalize transcript - be more permissive
                const normalized = transcript.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
                
                // Check for wake word - be very permissive
                const hasHey = normalized.includes('hey') || normalized.includes('hay');
                const hasCue = normalized.includes('cue') || normalized.includes('q') || normalized.includes('queue') || normalized.includes('kyu');
                
                // Also check for combined forms (no spaces)
                const noSpaces = normalized.replace(/\s/g, '');
                const hasCombined = noSpaces.includes('heycue') || noSpaces.includes('heyq') || noSpaces.includes('haycue') || noSpaces.includes('hayq');
                
                // Check if words appear close together (within 3 words)
                const words = normalized.split(/\s+/);
                let heyIndex = -1;
                let cueIndex = -1;
                for (let j = 0; j < words.length; j++) {
                    if (words[j].includes('hey') || words[j].includes('hay')) heyIndex = j;
                    if (words[j].includes('cue') || words[j].includes('q') || words[j].includes('queue') || words[j].includes('kyu')) cueIndex = j;
                }
                const wordsClose = heyIndex >= 0 && cueIndex >= 0 && Math.abs(heyIndex - cueIndex) <= 3;
                
                if ((hasHey && hasCue) || hasCombined || wordsClose) {
                    console.log('[cue] ✅ WAKE UP CALL DETECTED!');
                    wakeWordDetectedRef.current = true;
                    
                    // Stop recognition
                    try {
                        recognition.stop();
                    } catch (e) {
                        // Ignore errors
                    }
                    
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
                
                if (error === 'aborted') {
                    setIsListening(false);
                    return;
                }
                
                if (error === 'not-allowed') {
                    console.error('[cue] ❌ Microphone permission denied');
                    // Switch to offscreen document approach
                    setUseOffscreen(true);
                    setIsListening(false);
                    setError(null);
                    setTimeout(() => {
                        if (enabled) {
                            start();
                        }
                    }, 500);
                    return;
                }
                
                if (error === 'no-speech') {
                    return;
                }
                
                // Auto-restart on recoverable errors
                if (isListening && !isRestartingRef.current && !wakeWordDetectedRef.current) {
                    if (error !== 'aborted' && error !== 'not-allowed') {
                        isRestartingRef.current = true;
                        setTimeout(() => {
                            if (enabled && recognitionRef.current && !wakeWordDetectedRef.current && !isListening) {
                                try {
                                    recognitionRef.current.start();
                                } catch (e: any) {
                                    if (e.message && e.message.includes('already started')) {
                                        setIsListening(true);
                                    }
                                }
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
                        if (enabled && recognitionRef.current && !wakeWordDetectedRef.current && !isListening) {
                            try {
                                recognitionRef.current.start();
                            } catch (e: any) {
                                if (e.message && e.message.includes('already started')) {
                                    setIsListening(true);
                                }
                            }
                        }
                        isRestartingRef.current = false;
                    }, 1000);
                }
            };

            recognitionRef.current = recognition;
            setIsInitialized(true);

            return () => {
                console.log('[voice] Cleaning up SpeechRecognition...');
                if (recognitionRef.current) {
                    try {
                        recognitionRef.current.stop();
                    } catch (e) {
                        // Ignore errors
                    }
                    recognitionRef.current = null;
                }
            };
        } catch (e: any) {
            console.error('[voice] Failed to initialize SpeechRecognition:', e);
            setError(`Failed to initialize: ${e.message}`);
            setIsInitialized(false);
        }
    }, [checkCSPRestrictions, isLocalhostOrGoogle, requestPermissionIfNeeded]); // Only initialize once, not when enabled changes

    const start = useCallback(async () => {
        if (!isInitialized) {
            return;
        }
        
        // Don't start if already listening
        if (isListening) {
            return;
        }

        // If using offscreen document, start it via background script
        if (useOffscreen) {
            try {
                const response = await chrome.runtime.sendMessage({ type: 'START_WAKE_WORD' });
                if (response && response.success) {
                    setIsListening(true);
                    setError(null);
                } else {
                    setError(response?.error || 'Failed to start wake word detection');
                    setIsListening(false);
                }
            } catch (e: any) {
                setError(e.message || 'Failed to start wake word detection');
                setIsListening(false);
            }
            return;
        }

        // Content script approach
        if (!recognitionRef.current) {
            return;
        }
        
        // Don't start if already listening
        if (isListening) {
            return;
        }

        wakeWordDetectedRef.current = false;
        
        // Request mic access in content script to show tab indicator
        try {
            if (!indicatorStreamRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                indicatorStreamRef.current = stream;
                stream.getAudioTracks().forEach(track => {
                    track.enabled = true;
                });
            }
        } catch (e: any) {
            // Continue anyway - recognition will still work
        }

        // Start recognition directly
        try {
            if (!recognitionRef.current) {
                throw new Error('Recognition object is null');
            }
            
            // Check if recognition is already running before starting
            if (isListening) {
                console.log('[cue] Recognition already running, skipping start');
                return;
            }
            
            recognitionRef.current.start();
        } catch (e: any) {
            // If it's an "already started" error, that's actually okay - recognition is working
            if (e.message && e.message.includes('already started')) {
                setIsListening(true);
                setError(null);
                return;
            }
            
            console.error('[cue] ❌ Failed to start recognition:', e.message);
            setError(e.message || 'Failed to start recognition');
            setIsListening(false);
            
            // If it's a permission error, try offscreen as fallback
            if (e.message && (e.message.includes('not-allowed') || e.message.includes('permission'))) {
                console.error('[voice] Permission denied. Trying offscreen document as fallback...');
                console.error('[voice] This might be due to Content Security Policy restrictions on this page.');
                setUseOffscreen(true);
                // Start offscreen after state update
                setTimeout(async () => {
                    if (enabled) {
                        try {
                            const response = await chrome.runtime.sendMessage({ type: 'START_WAKE_WORD' });
                            if (response && response.success) {
                                console.log('[voice] ✅ Offscreen wake word detection started (fallback)');
                                setIsListening(true);
                                setError(null);
                            } else {
                                setError('Microphone permission denied. Please allow microphone access.');
                                setIsListening(false);
                            }
                        } catch (err: any) {
                            console.error('[voice] Failed to start offscreen fallback:', err);
                            setError('Microphone permission denied. Please allow microphone access.');
                            setIsListening(false);
                        }
                    }
                }, 500);
                return;
            }
            
            setError(e.message || 'Failed to start recognition');
            setIsListening(false);
        }
    }, [isInitialized, useOffscreen, enabled]);

    const stop = useCallback(() => {
        console.log('[voice] Stopping wake word detection...');
        
        // If using offscreen document, stop it via background script
        if (useOffscreen) {
            chrome.runtime.sendMessage({ type: 'STOP_WAKE_WORD' }).catch(() => {
                // Ignore errors
            });
            setIsListening(false);
            wakeWordDetectedRef.current = false;
            return;
        }
        
        // Content script approach
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
    }, [useOffscreen]);

    // Sync enabled state
    useEffect(() => {
        if (!isInitialized) {
            return;
        }

        if (enabled && !isListening) {
            // Small delay to ensure page is ready
            setTimeout(() => {
                start();
            }, 100);
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
