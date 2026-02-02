import React, { useState, useEffect, useRef, useCallback } from 'react';
// import { useWakeWord } from '../features/voice/useWakeWord'; // Disabled - wake word only works in extension
import { useSpeechRecognition } from '../features/voice/useSpeechRecognition';
import { checkMicrophonePermission, requestMicrophoneAccess } from '../features/voice/voiceUtils';

/**
 * DashboardHalo - Top bar for the dashboard matching the extension halo strip style
 */
function DashboardHalo() {
  const [chatOpen, setChatOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [aiAnswer, setAiAnswer] = useState(null);
  const [isThinking, setIsThinking] = useState(false);
  
  // Voice state
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false); // Disabled - wake word only works in extension
  const [needsPermission, setNeedsPermission] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  // autoSendEnabled removed - not needed since wake word is disabled in dashboard
  
  // Silence detection for auto-send
  const silenceTimeoutRef = useRef(null);
  const lastTranscriptTimeRef = useRef(null);

  const ADK_API_URL = 'http://localhost:8000';
  
  // Refs to store functions for use in callbacks
  const stopWakeWordRef = useRef(null);
  const resetTranscriptRef = useRef(null);
  const startRecognitionRef = useRef(null);
  const startWakeWordRef = useRef(null);
  const stopRecognitionRef = useRef(null);
  
  // Check microphone permission on mount (but don't enable wake word - it's extension-only)
  useEffect(() => {
    checkMicrophonePermission().then((permission) => {
      if (permission === 'granted') {
        setNeedsPermission(false);
        // Don't enable wake word - it only works in the extension floating tab
        setWakeWordEnabled(false);
      } else {
        setNeedsPermission(true);
      }
    });
  }, []);

  // Auto-send function - extracted for reuse
  const autoSendQueryRef = useRef(null);
  
  // Auto-send function
  const autoSendQuery = useCallback((queryText) => {
    if (!queryText.trim()) return;
    
    console.log('[voice] Auto-sending command:', queryText);
    // Stop transcription first
    setIsTranscribing(false);
    if (stopRecognitionRef.current) {
      stopRecognitionRef.current();
    }
    // Clear silence timeout
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    // Reset auto-send flag (removed - not needed)
    
    // Auto-submit the query
    const currentQuery = queryText.trim();
    setQuery('');
    setIsThinking(true);
    setAiAnswer(null);

    fetch(`${ADK_API_URL}/ask_ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: currentQuery,
        page_title: 'cue Dashboard',
        current_url: window.location.href,
        selected_text: '',
      }),
    })
    .then(response => response.json())
    .then(data => {
      setIsThinking(false);
      if (data.success && data.answer) {
        setAiAnswer(data.answer);
      } else {
        setAiAnswer(data.error || 'Failed to get AI response');
      }
      // Wake word detection is disabled in dashboard - only works in extension
    })
    .catch(error => {
      setIsThinking(false);
      setAiAnswer('Error connecting to server');
      // Wake word detection is disabled in dashboard - only works in extension
    });
  }, []);

  // Update ref when function changes
  useEffect(() => {
    autoSendQueryRef.current = autoSendQuery;
  }, [autoSendQuery]);

  // Speech recognition (activated after wake word or manual mic click)
  const handleTranscript = useCallback((text) => {
    setQuery(text);
    
    // Update last transcript time for silence detection
    lastTranscriptTimeRef.current = Date.now();
    
    // Clear existing silence timeout
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    
    // If we have text and are transcribing, set up auto-send on silence
    // Auto-send after 1.5 seconds of silence (user stopped speaking)
    if (text.trim() && isTranscribing) {
      silenceTimeoutRef.current = setTimeout(() => {
        console.log('[voice] Silence detected, auto-sending...');
        // Trigger auto-send with current transcript
        if (text.trim() && autoSendQueryRef.current) {
          autoSendQueryRef.current(text.trim());
        }
      }, 1500); // 1.5 seconds of silence
    }
  }, [isTranscribing, autoSendQueryRef]);

  // Handle final transcript - auto-send when user stops speaking
  const handleFinalTranscript = useCallback((text) => {
    setQuery(text);
    
    // Clear silence timeout since we got a final transcript
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    
    // Auto-send if we're transcribing (manual mic)
    if (isTranscribing && text.trim() && autoSendQueryRef.current) {
      autoSendQueryRef.current(text.trim());
    }
  }, [isTranscribing, autoSendQueryRef]);

  const {
    isListening: isRecognitionListening,
    error: recognitionError,
    start: startRecognition,
    stop: stopRecognition,
    reset: resetTranscript,
  } = useSpeechRecognition({
    onTranscript: handleTranscript,
    onFinalTranscript: handleFinalTranscript,
    enabled: false, // We'll control it manually to ensure proper timing
    continuous: true,
    interimResults: true,
  });

  // Cleanup silence timeout when transcription stops
  useEffect(() => {
    if (!isTranscribing && silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, [isTranscribing]);

  // Update refs when functions are available
  useEffect(() => {
    startRecognitionRef.current = startRecognition;
    resetTranscriptRef.current = resetTranscript;
    stopRecognitionRef.current = stopRecognition;
  }, [startRecognition, resetTranscript, stopRecognition]);

  // Handle wake word detection
  // Wake word handler - DISABLED: Wake word only works in extension floating tab
  // Users should use the extension's floating Halo strip for "Hey Cue" functionality
  // Removed handleWakeWordDetected - no longer needed

  // Wake word detection - DISABLED: Only works in extension floating tab, not in dashboard
  // Mock values since wake word is disabled
  const isWakeWordListening = false;
  const wakeWordError = null;
  const startWakeWord = useCallback(() => {}, []);
  const stopWakeWord = useCallback(() => {}, []);

  // Update refs when wake word functions are available
  useEffect(() => {
    stopWakeWordRef.current = stopWakeWord;
    startWakeWordRef.current = startWakeWord;
  }, [stopWakeWord, startWakeWord]);

  // Start transcription when isTranscribing becomes true (after wake word)
  useEffect(() => {
    let timer = null;
    
    if (isTranscribing && !isRecognitionListening) {
      console.log('[voice] Starting transcription after wake word...');
      // Ensure wake word is stopped first
      if (isWakeWordListening && stopWakeWordRef.current) {
        stopWakeWordRef.current();
      }
      // Ensure we have microphone permission before starting
      requestMicrophoneAccess()
        .then((stream) => {
          // Release the stream immediately - we just needed permission
          stream.getTracks().forEach(track => track.stop());
          // Delay to ensure wake word recognition has fully released the microphone
          timer = setTimeout(() => {
            console.log('[voice] Attempting to start transcription...');
            try {
              if (startRecognitionRef.current) {
                startRecognitionRef.current();
              }
            } catch (error) {
              console.error('[voice] Failed to start transcription:', error);
              setVoiceError(`Failed to start transcription: ${error.message}`);
              setIsTranscribing(false);
            }
          }, 400);
        })
        .catch((error) => {
          console.error('[voice] Microphone permission denied for transcription:', error);
          setVoiceError(`Microphone permission required: ${error.message}`);
          setIsTranscribing(false);
        });
    } else if (!isTranscribing && isRecognitionListening) {
      console.log('[voice] Stopping transcription...');
      stopRecognition();
      // Reset auto-send flag when transcription stops (removed - not needed)
      // Wake word detection is disabled in dashboard - only works in extension
      // No need to resume wake word detection
    }
    
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isTranscribing, isRecognitionListening, isWakeWordListening, startRecognition, stopRecognition, wakeWordEnabled, needsPermission, startWakeWord, stopWakeWord]);

  // Update listening state
  useEffect(() => {
    setIsVoiceListening(isWakeWordListening || isRecognitionListening);
  }, [isWakeWordListening, isRecognitionListening]);

  // Handle errors
  useEffect(() => {
    if (wakeWordError) {
      setVoiceError(wakeWordError);
    } else if (recognitionError) {
      setVoiceError(recognitionError);
    } else {
      setVoiceError(null);
    }
  }, [wakeWordError, recognitionError]);

  // Request microphone permission (for manual mic button, not wake word)
  const handleRequestPermission = useCallback(async () => {
    try {
      console.log('[voice] Requesting microphone permission...');
      const stream = await requestMicrophoneAccess();
      // Release the stream immediately - we just needed permission
      stream.getTracks().forEach(track => track.stop());
      console.log('[voice] Microphone permission granted');
      setNeedsPermission(false);
      // Don't enable wake word - it only works in extension
      setWakeWordEnabled(false);
      setVoiceError(null);
    } catch (error) {
      console.error('[voice] Permission denied:', error);
      setVoiceError(`Permission denied: ${error.message}. Please allow microphone access in your browser settings (click the lock icon in the address bar).`);
    }
  }, []);

  // Manual mic button click
  const handleMicClick = useCallback(async () => {
    if (needsPermission) {
      try {
        await handleRequestPermission();
        // After permission is granted, check if we should start transcription
        if (!isTranscribing) {
          // Start transcription after permission is granted
          setChatOpen(true);
          // Auto-send enabled (removed state - not needed)
          if (resetTranscriptRef.current) {
            resetTranscriptRef.current();
          }
          setQuery('');
          setTimeout(() => {
            setIsTranscribing(true);
            setTimeout(() => {
              if (startRecognitionRef.current) {
                startRecognitionRef.current();
              }
            }, 200);
          }, 200);
        }
      } catch (error) {
        setVoiceError(`Failed to get microphone permission: ${error.message}`);
      }
      return;
    }

    // Ensure we have permission even if needsPermission is false
    try {
      const permission = await checkMicrophonePermission();
      if (permission !== 'granted') {
        await requestMicrophoneAccess();
      }
    } catch (error) {
      setVoiceError(`Microphone permission required: ${error.message}`);
      return;
    }

    if (isTranscribing) {
      // Stop transcription
      stopRecognition();
      setIsTranscribing(false);
      // Auto-send disabled when manually stopping (removed state - not needed)
      if (resetTranscriptRef.current) {
        resetTranscriptRef.current();
      }
      // Wake word detection is disabled in dashboard - only works in extension
    } else {
      // Wake word detection is disabled in dashboard - only works in extension
      // Start transcription (manual mic - also auto-sends on silence)
      setChatOpen(true);
      // Manual mic also auto-sends when user stops speaking
      if (resetTranscriptRef.current) {
        resetTranscriptRef.current();
      }
      setQuery('');
      setTimeout(() => {
        setIsTranscribing(true);
        setTimeout(() => {
          if (startRecognitionRef.current) {
            startRecognitionRef.current();
          }
        }, 200);
      }, 200);
    }
  }, [needsPermission, isTranscribing, handleRequestPermission, stopRecognition]);

  const handleAsk = async () => {
    if (!query.trim()) return;
    const currentQuery = query.trim();
    setQuery('');
    setIsThinking(true);
    setAiAnswer(null);

    try {
      const response = await fetch(`${ADK_API_URL}/ask_ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: currentQuery,
          page_title: 'cue Dashboard',
          current_url: window.location.href,
          selected_text: '',
        }),
      });
      const data = await response.json();
      setIsThinking(false);
      if (data.success && data.answer) {
        setAiAnswer(data.answer);
      } else {
        setAiAnswer(data.error || 'Failed to get AI response');
      }
    } catch (error) {
      setIsThinking(false);
      setAiAnswer('Error connecting to server');
    }
  };

  const toggleChat = () => {
    setChatOpen(!chatOpen);
    if (chatOpen) {
      setAiAnswer(null);
      setIsThinking(false);
    }
  };

  return (
    <div className="dashboard-halo">
      {/* Logo and Brand */}
      <div className="halo-brand">
        <div className="halo-logo">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="url(#dashLogoGrad)" />
            <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="12" cy="14" r="2" fill="white"/>
            <defs>
              <linearGradient id="dashLogoGrad" x1="2" y1="2" x2="22" y2="22">
                <stop stopColor="#6366f1"/>
                <stop offset="1" stopColor="#8b5cf6"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <span className="halo-brand-text">cue</span>
      </div>

      {/* Start Session Button (disabled on dashboard) */}
      <button 
        className="halo-btn start-session disabled" 
        title="Use extension on websites to start a session"
        disabled
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <span>Start Session</span>
      </button>

      {/* Go Live Button (disabled on dashboard) */}
      <button 
        className="halo-btn go-live disabled" 
        title="Use extension on websites for Go Live"
        disabled
      >
        <span className="live-indicator"></span>
        <span>Go Live</span>
      </button>

      {/* Ask AI Button */}
      <button className="halo-btn ask-ai" onClick={toggleChat}>
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
        </svg>
        <span>Ask AI</span>
      </button>

      {/* Mic Button */}
      <button 
        className={`halo-btn mic-btn ${isTranscribing ? 'listening' : ''} ${isVoiceListening ? 'active' : ''}`}
        onClick={handleMicClick}
        title={needsPermission ? 'Enable microphone access' : (isTranscribing ? 'Stop listening' : 'Start voice input')}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
        {needsPermission && <span>Enable</span>}
        {!needsPermission && !isTranscribing && <span>Mic</span>}
        {isTranscribing && <span>Stop</span>}
      </button>

      {/* Library Button (current page indicator) */}
      <button className="halo-btn library active">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span>Library</span>
      </button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="halo-chat dashboard-chat">
          <div className="halo-chat-header">
            <span>Ask AI</span>
            <button className="halo-close" onClick={toggleChat}>×</button>
          </div>
          <div className="halo-input-wrapper">
            <input
              className="halo-input"
              placeholder="Ask anything about your sessions..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAsk();
              }}
            />
            {isTranscribing && (
              <div className="listening-indicator">
                <span className="listening-dot"></span>
                <span className="listening-text">Cue is listening...</span>
              </div>
            )}
          </div>
          <div className="halo-actions">
            <button className="halo-btn send-btn" onClick={handleAsk}>
              Send
            </button>
          </div>
          {isThinking && (
            <div className="halo-answer">
              <div className="halo-thinking">
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                Thinking...
              </div>
            </div>
          )}
          {aiAnswer && !isThinking && (
            <div className="halo-answer">
              <div className="halo-answer-text">{aiAnswer}</div>
            </div>
          )}
          {voiceError && (
            <div className="halo-error">
              <span>Voice error: {voiceError}</span>
              {needsPermission && (
                <button className="halo-btn permission-btn" onClick={handleRequestPermission}>
                  Enable Microphone
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DashboardHalo;
