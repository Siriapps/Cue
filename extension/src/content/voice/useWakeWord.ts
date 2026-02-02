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

    // Check if site has CSP restrictions (like YouTube)
    const checkCSPRestrictions = useCallback(() => {
        const hostname = window.location.hostname;
        // Sites known to block SpeechRecognition via CSP
        const cspRestrictedSites = [
            'youtube.com',
            'www.youtube.com',
            'youtu.be'
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
                console.log('[cue] 🎤 Wake up call detected signal received');
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
            return;
        }
        
        // Use content script approach for other sites
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        const isGoogleDomain = hostname.includes('google.com') || hostname.includes('youtube.com');
        
        console.log('[voice] Initializing SpeechRecognition in content script on:', hostname, 'protocol:', protocol);
        if (isGoogleDomain) {
            console.log('[voice] ✅ Google domain detected - Cue will work on this page');
        }
        
        // Check if SpeechRecognition is available
        const isAvailable = isSpeechRecognitionAvailable();
        console.log('[voice] SpeechRecognition available:', isAvailable, 'on:', hostname);
        
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
        
        console.log('[voice] SpeechRecognition constructor found, creating instance on:', hostname);
        setUseOffscreen(false);

        try {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            recognition.maxAlternatives = 1;

            recognition.onstart = () => {
                console.log('[voice] ✅ Wake word recognition started on:', window.location.hostname);
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
                        } catch (e) {
                            console.warn('[voice] Error stopping recognition:', e);
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
                console.log('[voice] Recognition error on:', window.location.hostname, 'error:', error);
                
                if (error === 'aborted') {
                    console.log('[voice] Recognition aborted');
                    setIsListening(false);
                    return;
                }
                
                if (error === 'not-allowed') {
                    console.error('[voice] ❌ Recognition error: not-allowed on:', window.location.hostname);
                    console.error('[voice] SpeechRecognition permission denied');
                    console.error('[voice] This page may have Content Security Policy restrictions');
                    console.log('[voice] Falling back to offscreen document approach...');
                    
                    // Switch to offscreen document approach
                    setUseOffscreen(true);
                    setIsListening(false);
                    setError(null); // Clear error, we'll try offscreen
                    
                    // Try starting with offscreen document
                    setTimeout(() => {
                        if (enabled) {
                            start();
                        }
                    }, 500);
                    return;
                }
                
                if (error === 'no-speech') {
                    // Normal - just means no speech detected yet
                    return;
                }
                
                console.warn('[voice] Recognition error on:', window.location.hostname, 'error:', error);
                
                // Auto-restart on recoverable errors
                if (isListening && !isRestartingRef.current && !wakeWordDetectedRef.current) {
                    if (error !== 'aborted' && error !== 'not-allowed') {
                        isRestartingRef.current = true;
                        setTimeout(() => {
                            if (enabled && recognitionRef.current && !wakeWordDetectedRef.current) {
                                try {
                                    console.log('[voice] Auto-restarting recognition on:', window.location.hostname);
                                    recognitionRef.current.start();
                                } catch (e) {
                                    console.error('[voice] Failed to restart on:', window.location.hostname, e);
                                }
                            }
                            isRestartingRef.current = false;
                        }, 1000);
                    }
                }
            };

            recognition.onend = () => {
                console.log('[voice] Recognition ended. enabled:', enabled, 'wakeWordDetected:', wakeWordDetectedRef.current);
                setIsListening(false);
                // Auto-restart if supposed to be listening
                if (enabled && !wakeWordDetectedRef.current && !isRestartingRef.current) {
                    isRestartingRef.current = true;
                    setTimeout(() => {
                        if (enabled && recognitionRef.current && !wakeWordDetectedRef.current) {
                            try {
                                console.log('[voice] Auto-restarting recognition after end...');
                                recognitionRef.current.start();
                            } catch (e) {
                                console.error('[voice] Failed to restart after end:', e);
                                isRestartingRef.current = false;
                            }
                        } else {
                            isRestartingRef.current = false;
                        }
                    }, 500);
                }
            };

            recognitionRef.current = recognition;
            setIsInitialized(true);
            console.log('[voice] SpeechRecognition initialized successfully');

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
            console.warn('[voice] Cannot start - not initialized. isInitialized:', isInitialized);
            return;
        }

        // If using offscreen document, start it via background script
        if (useOffscreen) {
            console.log('[voice] Starting wake word detection via offscreen document on:', window.location.hostname);
            try {
                const response = await chrome.runtime.sendMessage({ type: 'START_WAKE_WORD' });
                if (response && response.success) {
                    console.log('[voice] ✅ Offscreen wake word detection started');
                    setIsListening(true);
                    setError(null);
                } else {
                    console.error('[voice] Failed to start offscreen wake word:', response?.error);
                    setError(response?.error || 'Failed to start wake word detection');
                    setIsListening(false);
                }
            } catch (e: any) {
                console.error('[voice] Error starting offscreen wake word:', e);
                setError(e.message || 'Failed to start wake word detection');
                setIsListening(false);
            }
            return;
        }

        // Content script approach
        if (!recognitionRef.current) {
            console.warn('[voice] Cannot start - recognition not initialized');
            return;
        }

        console.log('[voice] Starting wake word detection on:', window.location.hostname);
        wakeWordDetectedRef.current = false;
        
        // Request mic access in content script to show tab indicator
        // For localhost and Google domains, ensure permission is granted
        try {
            if (!indicatorStreamRef.current) {
                const hostname = window.location.hostname;
                const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
                const isGoogleDomain = hostname.includes('google.com') || hostname.includes('youtube.com') || hostname.includes('gmail.com');
                
                if (isLocalhost) {
                    console.log('[voice] Requesting microphone permission for localhost:', hostname);
                } else if (isGoogleDomain) {
                    console.log('[voice] Requesting microphone permission for Google domain:', hostname);
                } else {
                    console.log('[voice] Requesting microphone for tab indicator...');
                }
                
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                indicatorStreamRef.current = stream;
                stream.getAudioTracks().forEach(track => {
                    track.enabled = true; // Keep enabled to show indicator
                });
                
                if (isLocalhost) {
                    console.log('[voice] ✅ Microphone permission granted for localhost:', hostname);
                } else if (isGoogleDomain) {
                    console.log('[voice] ✅ Microphone permission granted for Google domain:', hostname);
                } else {
                    console.log('[voice] ✅ Microphone stream active for indicator');
                }
            }
        } catch (e: any) {
            const hostname = window.location.hostname;
            const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('localhost:') || hostname.startsWith('127.0.0.1:');
            const isGoogleDomain = hostname.includes('google.com') || hostname.includes('youtube.com') || hostname.includes('gmail.com');
            
            if (isLocalhost) {
                console.error('[voice] ❌ Failed to get mic permission on localhost:', hostname, e.message);
                console.error('[voice] Please allow microphone access for localhost in your browser settings');
            } else if (isGoogleDomain) {
                console.error('[voice] ❌ Failed to get mic permission on Google domain:', hostname, e.message);
                console.error('[voice] Please allow microphone access for this Google domain in your browser settings');
            } else {
                console.warn('[voice] Failed to get mic stream for indicator:', e.message);
            }
            // Continue anyway - recognition will still work
        }

        // Start recognition directly
        try {
            const hostname = window.location.hostname;
            const isGoogleDomain = hostname.includes('google.com') || hostname.includes('youtube.com');
            
            if (isGoogleDomain) {
                console.log('[voice] 🎤 Starting wake word detection on Google domain:', hostname);
            } else {
                console.log('[voice] Attempting to start SpeechRecognition on:', hostname);
            }
            console.log('[voice] Page URL:', window.location.href);
            console.log('[voice] Recognition object:', recognitionRef.current);
            
            // Check if recognition is in a valid state
            if (!recognitionRef.current) {
                throw new Error('Recognition object is null');
            }
            
            recognitionRef.current.start();
            
            if (isGoogleDomain) {
                console.log('[voice] ✅ Wake word detection started on Google domain:', hostname);
                console.log('[voice] Say "Hey Cue" to activate Cue on this Google page');
            } else {
                console.log('[voice] ✅ Wake word detection started on:', hostname);
            }
        } catch (e: any) {
            console.error('[voice] ❌ Failed to start recognition on:', window.location.hostname);
            console.error('[voice] Error details:', e.message, e.name, e);
            
            // If it's an "already started" error, that's actually okay
            if (e.message && e.message.includes('already started')) {
                console.log('[voice] Recognition already started (this is okay)');
                setIsListening(true);
                setError(null);
                return;
            }
            
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
            console.log('[voice] Not initialized yet, waiting... hostname:', window.location.hostname);
            return;
        }

        console.log('[voice] Enabled state changed. enabled:', enabled, 'isListening:', isListening, 'hostname:', window.location.hostname, 'URL:', window.location.href);

        if (enabled && !isListening) {
            console.log('[voice] Starting wake word detection (enabled=true) on:', window.location.hostname);
            // Small delay to ensure page is ready
            setTimeout(() => {
                start();
            }, 100);
        } else if (!enabled && isListening) {
            console.log('[voice] Stopping wake word detection (enabled=false) on:', window.location.hostname);
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
