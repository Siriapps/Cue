import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { startGoLive, stopGoLive } from "./go_live";
import { summarizePage } from "./readability";
import { startMicRecording, pauseMicRecording, resumeMicRecording, stopMicRecording } from "./session_recorder";
import { useWakeWord } from "./voice/useWakeWord";
import { useSpeechRecognition } from "./voice/useSpeechRecognition";
import { requestMicrophoneAccess } from "./voice/voiceUtils";

const LIBRARY_URL = "http://localhost:3001";

type SessionState = "idle" | "recording" | "paused";

export function HaloStrip(): React.JSX.Element {
  // UI State
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  // Session Recording State
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Go Live State
  const [isLive, setIsLive] = useState(false);

  // Voice/Transcription State
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [autoSendEnabled, setAutoSendEnabled] = useState(false);
  const silenceTimeoutRef = useRef<number | null>(null);
  const lastTranscriptTimeRef = useRef<number | null>(null);
  const wakeWordStopRef = useRef<(() => void) | null>(null);
  const recognitionStartRef = useRef<(() => void) | null>(null);
  const recognitionStopRef = useRef<(() => void) | null>(null);
  const recognitionResetRef = useRef<(() => void) | null>(null);

  // Load collapsed state from storage
  useEffect(() => {
    try {
      if (!chrome?.storage?.local) {
        throw new Error("Extension context invalidated");
      }
      chrome.storage.local.get(["haloCollapsed"], (result) => {
        if (chrome.runtime.lastError) {
          console.error("[cue] Failed to load collapsed state:", chrome.runtime.lastError.message);
          return;
        }
        if (result.haloCollapsed !== undefined) {
          setIsCollapsed(result.haloCollapsed);
        }
      });
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
    }
  }, []);

  // Timer effect for recording
  useEffect(() => {
    if (sessionState === "recording" && sessionStartTime) {
      timerRef.current = window.setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - sessionStartTime) / 1000));
      }, 1000);
    } else if (sessionState === "paused") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    } else if (sessionState === "idle") {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setElapsedTime(0);
      setSessionStartTime(null);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [sessionState, sessionStartTime]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const placeholder = useMemo(() => {
    const hostname = window.location.hostname || "this page";
    return `Ask anything about ${hostname}...`;
  }, []);

  const toggleCollapse = useCallback(() => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    try {
      if (!chrome?.storage?.local) {
        throw new Error("Extension context invalidated");
      }
      chrome.storage.local.set({ haloCollapsed: newState }, () => {
        if (chrome.runtime.lastError) {
          console.error("[cue] Failed to save collapsed state:", chrome.runtime.lastError.message);
        }
      });
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
    }
  }, [isCollapsed]);

  const toggleChat = () => {
    setChatOpen((prev) => !prev);
    if (chatOpen) {
      setAiAnswer(null);
      setIsThinking(false);
    }
  };

  const openLibrary = () => {
    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage({ type: "OPEN_LIBRARY", url: LIBRARY_URL }, (response) => {
        // Check for errors
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message;
          console.error("[cue] Failed to open library:", errorMsg);
          // If context invalidated, try direct window.open as fallback
          if (errorMsg.includes("message port closed") || errorMsg.includes("Extension context invalidated")) {
            window.open(LIBRARY_URL, '_blank');
          }
          return;
        }
      });
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
      // Fallback: open library directly
      try {
        window.open(LIBRARY_URL, '_blank');
      } catch (e) {
        console.error("[cue] Failed to open library window:", e);
      }
    }
  };

  // Auto-send function - extracted for reuse
  const autoSendQuery = useCallback((text: string) => {
    if (!text.trim()) return;
    
    const currentQuery = text.trim();
    setQuery("");
    setIsThinking(true);
    setAiAnswer(null);
    setIsTranscribing(false);
    
    // Stop transcription
    if (recognitionStopRef.current) {
      recognitionStopRef.current();
    }

    const selectedText = window.getSelection()?.toString() || "";

    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage(
        {
          type: "ASK_AI",
          query: currentQuery,
          selectedText: selectedText.substring(0, 500),
        },
        (response) => {
          setIsThinking(false);
          if (chrome.runtime.lastError) {
            console.error("[cue] Failed to ask AI:", chrome.runtime.lastError.message);
            setAiAnswer("Extension context invalidated. Please reload the page.");
            return;
          }
          if (response?.success && response?.answer) {
            setAiAnswer(response.answer);
          } else {
            setAiAnswer(response?.error || "Failed to get AI response");
          }
        }
      );
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
      setIsThinking(false);
      setAiAnswer("Extension context invalidated. Please reload the page.");
    }
  }, []);

  const handleAsk = () => {
    if (!query.trim()) return;
    
    // Stop transcription if active
    if (isTranscribing && recognitionStopRef.current) {
      recognitionStopRef.current();
      setIsTranscribing(false);
    }
    
    autoSendQuery(query);
  };

  // Speech Recognition - handles transcription after wake word
  const handleTranscript = useCallback((text: string) => {
    setQuery(text);
    lastTranscriptTimeRef.current = Date.now();
    
    // Clear existing silence timeout
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    
    // Auto-send after 1.5 seconds of silence
    if (text.trim() && isTranscribing && autoSendEnabled) {
      silenceTimeoutRef.current = window.setTimeout(() => {
        console.log("[cue] Silence detected, auto-sending...");
        if (text.trim()) {
          // Stop transcription and hide "Listening" before sending
          if (recognitionStopRef.current) {
            recognitionStopRef.current();
          }
          setIsTranscribing(false);
          setAutoSendEnabled(false);
          autoSendQuery(text.trim());
        }
      }, 1500);
    }
  }, [isTranscribing, autoSendEnabled, autoSendQuery]);

  const handleFinalTranscript = useCallback((text: string) => {
    setQuery(text);
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  const {
    isListening: isRecognitionListening,
    transcript,
    error: recognitionError,
    start: startRecognition,
    stop: stopRecognition,
    reset: resetTranscript,
  } = useSpeechRecognition({
    onTranscript: handleTranscript,
    onFinalTranscript: handleFinalTranscript,
    enabled: false, // We'll control it manually
    continuous: true,
    interimResults: true,
  });

  // Store refs for use in callbacks
  useEffect(() => {
    recognitionStartRef.current = startRecognition;
    recognitionStopRef.current = stopRecognition;
    recognitionResetRef.current = resetTranscript;
  }, [startRecognition, stopRecognition, resetTranscript]);

  // Wake Word Integration
  const { 
    stop: stopWakeWord, 
    isListening: isWakeWordListening,
    error: wakeWordError 
  } = useWakeWord({
    enabled: sessionState === "idle" && !isLive && !isTranscribing, // Disable when recording, live, or transcribing
    onWakeWordDetected: async () => {
      // Check if this tab is the active/focused tab before responding
      if (!document.hasFocus()) {
        console.log("[cue] Wake word detected but this tab is not active, ignoring...");
        return;
      }
      
      console.log("[cue] 🎤 Wake up call detected! Opening chat and starting transcription...");
      
      // Only activate if not already recording a session or live streaming
      if (sessionState === "idle" && !isLive && !isTranscribing) {
        // Stop wake word detection
        if (stopWakeWord) {
          stopWakeWord();
        }
        
        // Open chat panel
        setChatOpen(true);
        
        // Reset transcript and clear query
        if (recognitionResetRef.current) {
          recognitionResetRef.current();
        }
        setQuery('');
        
        // Enable auto-send for wake word triggered commands
        setAutoSendEnabled(true);
        
        // Show "Listening" indicator immediately
        setIsTranscribing(true);
        
        try {
          // Request microphone permission
          await requestMicrophoneAccess();
        } catch (error: any) {
          console.error("[cue] Microphone permission denied after wake word:", error);
          setIsTranscribing(false);
          return;
        }
        
        // Wait a moment for wake word recognition to fully release the microphone
        // Then start transcription
        setTimeout(() => {
          // The useSpeechRecognition hook will auto-start when enabled becomes true
          // But we'll also manually start it to ensure it happens
          setTimeout(() => {
            if (recognitionStartRef.current) {
              console.log("[cue] Starting transcription after wake word...");
              recognitionStartRef.current();
            }
          }, 100);
        }, 300);
      } else {
        console.log("[cue] Wake word detected but session is active, ignoring...");
      }
    }
  });

  // Store wake word stop ref
  useEffect(() => {
    wakeWordStopRef.current = stopWakeWord;
  }, [stopWakeWord]);

  // Start transcription when isTranscribing becomes true
  useEffect(() => {
    let timer: number | null = null;
    
    if (isTranscribing && !isRecognitionListening) {
      console.log("[cue] Starting transcription after wake word...");
      // Ensure wake word is stopped first
      if (wakeWordStopRef.current) {
        wakeWordStopRef.current();
      }
      // Ensure we have microphone permission before starting
      requestMicrophoneAccess()
        .then((stream) => {
          // Release the stream immediately - we just needed permission
          stream.getTracks().forEach(track => track.stop());
          // Delay to ensure wake word recognition has fully released the microphone
          timer = window.setTimeout(() => {
            console.log("[cue] Attempting to start transcription...");
            try {
              if (recognitionStartRef.current) {
                recognitionStartRef.current();
              }
            } catch (error: any) {
              console.error("[cue] Failed to start transcription:", error);
              setIsTranscribing(false);
            }
          }, 400);
        })
        .catch((error: any) => {
          console.error("[cue] Microphone permission denied for transcription:", error);
          setIsTranscribing(false);
        });
    } else if (!isTranscribing && isRecognitionListening) {
      console.log("[cue] Stopping transcription...");
      stopRecognition();
      // Reset auto-send flag when transcription stops
      setAutoSendEnabled(false);
      // Resume wake word detection after transcription stops
      if (sessionState === "idle" && !isLive) {
        setTimeout(() => {
          console.log("[cue] Resuming wake word detection...");
          // Wake word will auto-start when enabled becomes true
        }, 500);
      }
    }
    
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isTranscribing, isRecognitionListening, sessionState, isLive, stopRecognition]);

  // Cleanup silence timeout
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, []);

  // Session Controls
  const handleStartSession = async () => {
    try {
      setSessionState("recording");
      setSessionStartTime(Date.now());

      // Start mic recording
      await startMicRecording();

      // Get page info for the session
      const pageTitle = document.title;
      const pageUrl = window.location.href;

      // Notify background script
      try {
        if (!chrome?.runtime?.id) {
          throw new Error("Extension context invalidated");
        }
        chrome.runtime.sendMessage({
          type: "SESSION_START",
          payload: {
            title: pageTitle,
            url: pageUrl,
            startTime: Date.now(),
          },
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("[cue] Failed to start session:", chrome.runtime.lastError.message);
            setSessionState("idle");
          }
        });
      } catch (error: any) {
        console.error("[cue] Extension context invalidated:", error.message);
        setSessionState("idle");
      }
    } catch (error: any) {
      console.error("[cue] Failed to start session:", error);
      setSessionState("idle");
      alert(`Failed to start recording: ${error.message}\n\nPlease allow microphone access.`);
    }
  };

  const handlePauseSession = () => {
    pauseMicRecording();
    setSessionState("paused");
    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage({ type: "SESSION_PAUSE" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[cue] Failed to pause session:", chrome.runtime.lastError.message);
        }
      });
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
    }
  };

  const handleResumeSession = () => {
    resumeMicRecording();
    setSessionState("recording");
    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage({ type: "SESSION_RESUME" }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[cue] Failed to resume session:", chrome.runtime.lastError.message);
        }
      });
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
    }
  };

  const handleStopSession = async () => {
    try {
      setSessionState("idle");

      // Stop mic recording and get audio blob
      const audioBlob = await stopMicRecording();

      // Convert to base64
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Failed to read audio"));
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1] || "";
          resolve(base64);
        };
        reader.readAsDataURL(audioBlob);
      });

      // Get page info
      const pageTitle = document.title;
      const pageUrl = window.location.href;

      // Send to background for processing
      try {
        if (!chrome?.runtime?.id) {
          throw new Error("Extension context invalidated");
        }
        chrome.runtime.sendMessage(
          {
            type: "SESSION_STOP",
            payload: {
              title: pageTitle,
              url: pageUrl,
              duration: elapsedTime,
              audio_base64: audioBase64,
              mime_type: "audio/webm",
            },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error("[cue] Failed to save session:", chrome.runtime.lastError.message);
              return;
            }
            if (response?.success) {
              console.log("[cue] Session saved:", response.sessionId);
            } else {
              console.error("[cue] Failed to save session:", response?.error);
            }
          }
        );
      } catch (error: any) {
        console.error("[cue] Extension context invalidated:", error.message);
      }
    } catch (error: any) {
      console.error("[cue] Failed to stop session:", error);
      setSessionState("idle");
    }
  };

  // Go Live Controls
  const handleGoLive = async () => {
    if (isLive) {
      stopGoLive();
      setIsLive(false);
      return;
    }
    await startGoLive();
    setIsLive(true);
  };

  // Listen for messages from background
  useEffect(() => {
    try {
      if (!chrome?.runtime?.onMessage) {
        throw new Error("Extension context invalidated");
      }
      const listener = (message: any) => {
        if (message?.type === "PRISM_RESULT") {
          setChatOpen(true);
        } else if (message?.type === "AI_ANSWER") {
          setIsThinking(false);
          if (message.payload?.success && message.payload?.answer) {
            setAiAnswer(message.payload.answer);
          } else {
            setAiAnswer(message.payload?.error || "Failed to get AI response");
          }
        } else if (message?.type === "GO_LIVE_STARTED") {
          setIsLive(true);
        } else if (message?.type === "GO_LIVE_STOPPED") {
          setIsLive(false);
        } else if (message?.type === "SESSION_SAVED") {
          // Session was saved successfully
          setSessionState("idle");
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => {
        try {
          chrome.runtime.onMessage.removeListener(listener);
        } catch (error: any) {
          console.error("[cue] Failed to remove listener:", error.message);
        }
      };
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
    }
  }, []);

  // Collapsed view - floating icon in top-right
  // Uses fixed positioning since parent host is centered
  if (isCollapsed) {
    return (
      <div
        className="halo-collapsed"
        onClick={toggleCollapse}
        style={{
          position: 'fixed',
          top: '12px',
          right: '20px',
          left: 'auto',
          transform: 'none',
          pointerEvents: 'auto',
          zIndex: 2147483647,
        }}
      >
        <div className="halo-collapsed-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" fill="url(#logoGradCollapsed)" />
            <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="14" r="2" fill="white" />
            <defs>
              <linearGradient id="logoGradCollapsed" x1="2" y1="2" x2="22" y2="22">
                <stop stopColor="#6366f1" />
                <stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
          </svg>
          {sessionState === "recording" && <span className="recording-badge"></span>}
        </div>
      </div>
    );
  }

  return (
    <div className="halo-strip">
      {/* Centered Content Container */}
      <div className="halo-content-center">
        {/* Logo and Brand */}
        <div className="halo-brand">
          <div className="halo-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" fill="url(#logoGrad)" />
              <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="14" r="2" fill="white" />
              <defs>
                <linearGradient id="logoGrad" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="halo-brand-text">cue</span>
          {/* Listening Indicator - Only show when actually transcribing (after wake word) */}
          {isTranscribing && (
            <div 
              className="wake-word-indicator" 
              title="Listening and transcribing..."
            >
              <svg 
                viewBox="0 0 24 24" 
                fill="currentColor" 
                width="12" 
                height="12"
                className="wake-word-mic-icon"
              >
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
              <span>Listening</span>
            </div>
          )}
        </div>

        {/* Session Controls */}
        <div className="halo-session-controls">
          {sessionState === "idle" ? (
            <button className="halo-btn start-session" onClick={handleStartSession}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M8 5v14l11-7z" />
              </svg>
              <span>Start Session</span>
            </button>
          ) : (
            <>
              {/* Timer Display */}
              <div className="session-timer">
                <span className={`recording-dot ${sessionState === "recording" ? "active" : ""}`}></span>
                <span className="timer-text">{formatTime(elapsedTime)}</span>
              </div>

              {/* Pause/Resume Button */}
              {sessionState === "recording" ? (
                <button className="halo-btn pause-btn" onClick={handlePauseSession} title="Pause">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                </button>
              ) : (
                <button className="halo-btn resume-btn" onClick={handleResumeSession} title="Resume">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              )}

              {/* Stop Button */}
              <button className="halo-btn stop-btn" onClick={handleStopSession} title="Stop & Save">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
                <span>Stop</span>
              </button>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="halo-divider"></div>

        {/* Go Live Button */}
        <button
          className={`halo-btn go-live ${isLive ? "active" : ""}`}
          onClick={handleGoLive}
        >
          <span className="live-indicator"></span>
          <span>{isLive ? "Live" : "Go Live"}</span>
        </button>

        {/* Ask AI Button - with visual feedback when transcribing */}
        <button 
          className={`halo-btn ask-ai ${isTranscribing ? "recording" : ""}`} 
          onClick={toggleChat}
          title={isTranscribing ? "Listening..." : "Ask AI"}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
          </svg>
          <span>{isTranscribing ? "Listening..." : "Ask AI"}</span>
          {isTranscribing && <span className="pulse-indicator"></span>}
        </button>

        {/* Library Button */}
        <button className="halo-btn library" onClick={openLibrary}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          <span>Library</span>
        </button>
      </div>

      {/* Minimize Button - Right Side */}
      <button className="halo-collapse-btn" onClick={toggleCollapse} title="Minimize">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="halo-chat">
          <div className="halo-chat-header">
            <span>Ask AI</span>
            <button className="halo-close" onClick={toggleChat}>×</button>
          </div>
          <input
            className="halo-input"
            placeholder={isTranscribing ? "Listening..." : placeholder}
            value={isTranscribing ? (transcript || query || "") : query}
            onChange={(e) => {
              // Allow manual editing
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation(); // Prevent YouTube/page from capturing keys
              if (e.key === "Enter") {
                // Stop transcription if active
                // Stop transcription when user manually sends
                if (isTranscribing && recognitionStopRef.current) {
                  recognitionStopRef.current();
                  setIsTranscribing(false);
                  setAutoSendEnabled(false);
                }
                handleAsk();
              }
            }}
            onKeyUp={(e) => e.stopPropagation()}
            onKeyPress={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => e.stopPropagation()}
          />
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
        </div>
      )}
    </div>
  );
}
