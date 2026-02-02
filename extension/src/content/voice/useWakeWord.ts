import { useState, useEffect, useRef, useCallback } from 'react';

// Simple permission check - fully relies on background script/offscreen for actual detection


interface UseWakeWordOptions {
    onWakeWordDetected?: () => void;
    enabled?: boolean;
}

/**
 * Hook for wake word detection using Offscreen Document via Background Script
 * This avoids permission issues on restricted pages by running recognition in the extension context
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

    // Keep refs in sync
    useEffect(() => {
        onWakeWordDetectedRef.current = onWakeWordDetected;
    }, [onWakeWordDetected]);

    // Handle messages from background
    useEffect(() => {
        const handleMessage = (message: any) => {
            if (message.type === 'WAKE_WORD_DETECTED') {
                console.log('[voice] Wake word detected signal received from background');
                if (onWakeWordDetectedRef.current) {
                    onWakeWordDetectedRef.current();
                }
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);
        return () => chrome.runtime.onMessage.removeListener(handleMessage);
    }, []);

    // Initialize and listen for permission changes
    // Initialize and listen for permission changes
    useEffect(() => {
        // We assume initialized until proven otherwise by a failed START command
        // This avoids false negatives from checking host page permissions
        setIsInitialized(true);

        const handlePermissionUpdate = (message: any) => {
            if (message.type === 'PERMISSION_UPDATED') {
                console.log('[voice] Permission updated, retrying start...');
                if (enabled) {
                    setIsInitialized(true); // Ensure we are ready
                    // Note: 'start' dependency might trigger this, or call explicitly if needed
                    // But since we just set isInitialized, the sync effect below might pick it up
                }
            }
        };

        chrome.runtime.onMessage.addListener(handlePermissionUpdate);
        return () => chrome.runtime.onMessage.removeListener(handlePermissionUpdate);
    }, [enabled]);

    const start = useCallback(() => {
        if (!isInitialized) return;

        console.log('[voice] Requesting wake word start...');
        chrome.runtime.sendMessage({ type: 'START_WAKE_WORD' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[voice] Failed to start wake word:', chrome.runtime.lastError);
                setError(chrome.runtime.lastError.message || 'Failed to start');
                setIsListening(false);
                return;
            }

            if (response && !response.success) {
                console.error('[voice] Background failed to start wake word:', response.error);
                setError(response.error);
                setIsListening(false);
            } else {
                console.log('[voice] Wake word detection started');
                setIsListening(true);
                setError(null);
            }
        });
    }, [isInitialized]);

    const stop = useCallback(() => {
        console.log('[voice] Requesting wake word stop...');
        chrome.runtime.sendMessage({ type: 'STOP_WAKE_WORD' }, () => {
            setIsListening(false);
            if (chrome.runtime.lastError) {
                // Ignore errors on stop
                console.warn('[voice] Error stopping wake word:', chrome.runtime.lastError.message);
            }
        });
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

    return {
        isListening,
        isInitialized,
        error,
        start,
        stop
    };
}
