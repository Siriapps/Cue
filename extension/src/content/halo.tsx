import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { startGoLive, stopGoLive } from "./go_live";
import { summarizePage } from "./readability";
import { startMicRecording, pauseMicRecording, resumeMicRecording, stopMicRecording } from "./session_recorder";
import type { CueContext } from "../shared/context_store";

const LIBRARY_URL = import.meta.env.VITE_LIBRARY_URL || "http://localhost:3001";

type SessionState = "idle" | "recording" | "paused";

export function HaloStrip(): React.JSX.Element {
  // UI State
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  // Login state
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Command state (for @mention commands)
  const [commandPreview, setCommandPreview] = useState<{
    service: string;
    action: string;
    params: Record<string, unknown>;
    original_query: string;
  } | null>(null);

  // Session Recording State
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Go Live State
  const [isLive, setIsLive] = useState(false);

  // Context panel (GetContext)
  const [contextOpen, setContextOpen] = useState(false);
  const [contextSnapshot, setContextSnapshot] = useState<CueContext | null>(null);
  const [includeContextForAI, setIncludeContextForAI] = useState(false);
  const [suggestionText, setSuggestionText] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);

  // Check login status on mount
  useEffect(() => {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: "CHECK_LOGIN" }, (response) => {
        if (chrome.runtime.lastError) return;
        setIsLoggedIn(response?.loggedIn || false);
      });
    } catch {
      // Extension context invalidated
    }
  }, []);

  // Listen for COMMAND_RESULT and COMMAND_EXECUTED from background
  useEffect(() => {
    const listener = (message: { type?: string; payload?: unknown }) => {
      if (message.type === "COMMAND_RESULT" && message.payload) {
        const p = message.payload as {
          preview?: boolean;
          service?: string;
          action?: string;
          params?: Record<string, unknown>;
          original_query?: string;
          error?: string;
        };
        if (p.preview && p.service && p.action) {
          setCommandPreview({
            service: p.service,
            action: p.action,
            params: p.params || {},
            original_query: p.original_query || "",
          });
          setIsThinking(false);
        }
      }
      if (message.type === "COMMAND_EXECUTED" && message.payload) {
        const p = message.payload as { success?: boolean; message?: string; error?: string };
        if (p.success) {
          const msg = (p.message || "").trim();
          setAiAnswer(msg ? (msg.toLowerCase() === "done" ? "Command completed." : msg) : "Command completed.");
        } else {
          setAiAnswer(`Error: ${p.error || "Command failed"}`);
        }
        setCommandPreview(null);
        setIsThinking(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

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

  const toggleContext = useCallback(() => {
    const next = !contextOpen;
    setContextOpen(next);
    if (next) {
      try {
        if (!chrome?.runtime?.id) return;
        chrome.runtime.sendMessage({ type: "CONTEXT_GET_SNAPSHOT" }, (response) => {
          if (chrome.runtime.lastError) return;
          if (response?.success && response.snapshot) setContextSnapshot(response.snapshot);
        });
      } catch {
        // ignore
      }
    } else {
      setContextSnapshot(null);
      setSuggestionText(null);
    }
  }, [contextOpen]);

  const setIncludeContextPreference = useCallback((checked: boolean) => {
    setIncludeContextForAI(checked);
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ cueIncludeContextForAI: checked }, () => {});
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshSearches = useCallback(() => {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: "CONTEXT_REFRESH_SEARCHES" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.success && response.snapshot) setContextSnapshot(response.snapshot);
      });
    } catch {
      // ignore
    }
  }, []);

  const clearContext = useCallback(() => {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: "CONTEXT_CLEAR" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.success) setContextSnapshot({ recent_searches: [], recent_ai_chats: {}, updatedAt: Date.now() });
      });
    } catch {
      // ignore
    }
  }, []);

  const suggestFromContext = useCallback(() => {
    setIsSuggesting(true);
    setSuggestionText(null);
    try {
      if (!chrome?.runtime?.id) {
        setIsSuggesting(false);
        return;
      }
      chrome.runtime.sendMessage({ type: "CONTEXT_SUGGEST" }, (response) => {
        setIsSuggesting(false);
        if (chrome.runtime.lastError) {
          setSuggestionText("Failed to get suggestion.");
          return;
        }
        if (response?.success && response.suggestion) {
          setSuggestionText(response.suggestion);
        } else {
          setSuggestionText(response?.error || "No suggestion.");
        }
      });
    } catch {
      setIsSuggesting(false);
      setSuggestionText("Failed to get suggestion.");
    }
  }, []);

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

  const handleAsk = () => {
    if (!query.trim()) return;
    const currentQuery = query.trim();
    setQuery("");
    setIsThinking(true);
    setAiAnswer(null);
    setCommandPreview(null);

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
          includeContext: includeContextForAI,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            setIsThinking(false);
            console.error("[cue] Failed to ask AI:", chrome.runtime.lastError.message);
            setAiAnswer("Extension context invalidated. Please reload the page.");
            return;
          }

          // Check if this is a command response (preview)
          if (response?.type === "command" && response?.preview) {
            setCommandPreview({
              service: response.service,
              action: response.action,
              params: response.params || {},
              original_query: response.original_query || currentQuery,
            });
            setIsThinking(false);
          } else if (response?.type === "command" && response?.error) {
            setIsThinking(false);
            setAiAnswer(response.error);
          } else if (response?.success && response?.answer) {
            setIsThinking(false);
            setAiAnswer(response.answer);
          } else {
            setIsThinking(false);
            setAiAnswer(response?.error || "Failed to get AI response");
          }
        }
      );
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
      setIsThinking(false);
      setAiAnswer("Extension context invalidated. Please reload the page.");
    }
  };

  // Confirm and execute command
  const handleConfirmCommand = () => {
    if (!commandPreview) return;
    setIsThinking(true);

    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage(
        {
          type: "EXECUTE_COMMAND",
          service: commandPreview.service,
          command: commandPreview.original_query.replace(/^@\w+\s+/, ""),
        },
        (response) => {
          setIsThinking(false);
          if (chrome.runtime.lastError) {
            setAiAnswer("Failed to execute command.");
            setCommandPreview(null);
            return;
          }
          if (response?.success) {
            const msg = (response.message || "").trim();
            setAiAnswer(msg ? (msg.toLowerCase() === "done" ? "Command completed." : msg) : "Command completed.");
          } else {
            setAiAnswer(`Error: ${response?.error || "Command failed"}`);
          }
          setCommandPreview(null);
        }
      );
    } catch {
      setIsThinking(false);
      setAiAnswer("Extension context invalidated.");
      setCommandPreview(null);
    }
  };

  // Cancel command preview
  const handleCancelCommand = () => {
    setCommandPreview(null);
  };

  // Handle login
  const handleLogin = () => {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: "GOOGLE_LOGIN" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.success) {
          setIsLoggedIn(true);
        }
      });
    } catch {
      // Extension context invalidated
    }
  };

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
            <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="12" cy="14" r="2" fill="white"/>
            <defs>
              <linearGradient id="logoGradCollapsed" x1="2" y1="2" x2="22" y2="22">
                <stop stopColor="#6366f1"/>
                <stop offset="1" stopColor="#8b5cf6"/>
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
              <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="14" r="2" fill="white"/>
              <defs>
                <linearGradient id="logoGrad" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#6366f1"/>
                  <stop offset="1" stopColor="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="halo-brand-text">cue</span>
        </div>

        {/* Session Controls */}
        <div className="halo-session-controls">
          {sessionState === "idle" ? (
            <button className="halo-btn start-session" onClick={handleStartSession}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M8 5v14l11-7z"/>
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
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                  </svg>
                </button>
              ) : (
                <button className="halo-btn resume-btn" onClick={handleResumeSession} title="Resume">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </button>
              )}

              {/* Stop Button */}
              <button className="halo-btn stop-btn" onClick={handleStopSession} title="Stop & Save">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
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

        {/* Ask AI Button */}
        <button className="halo-btn ask-ai" onClick={toggleChat}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
          <span>Ask AI</span>
        </button>

        {/* Context Button */}
        <button
          className={`halo-btn context ${contextOpen ? "active" : ""}`}
          onClick={toggleContext}
          title="Context"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <span>Context</span>
        </button>

        {/* Library Button */}
        <button className="halo-btn library" onClick={openLibrary}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
          <span>Library</span>
        </button>

      </div>

      {/* Minimize Button - Right Side */}
      <button className="halo-collapse-btn" onClick={toggleCollapse} title="Minimize">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Chat Panel */}
      {chatOpen && (
        <div className="halo-chat">
          <div className="halo-chat-header">
            <span>Ask AI</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {!isLoggedIn && (
                <button
                  className="halo-btn"
                  onClick={handleLogin}
                  style={{ fontSize: '11px', padding: '4px 8px' }}
                >
                  Sign in
                </button>
              )}
              <button className="halo-close" onClick={toggleChat}>×</button>
            </div>
          </div>

          {/* Command hints */}
          <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '8px' }}>
            Try: @gmail draft... | @calendar create... | @tasks add...
          </div>

          <input
            className="halo-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") handleAsk();
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

          {/* Command Preview */}
          {commandPreview && !isThinking && (
            <div className="halo-answer halo-answer-command" style={{ borderLeft: '3px solid #8b5cf6' }}>
              <div style={{ fontSize: '12px', color: '#5b21b6', marginBottom: '8px', fontWeight: 600 }}>
                @{commandPreview.service} - {commandPreview.action}
              </div>
              <div className="halo-answer-text" style={{ fontSize: '13px', marginBottom: '12px', color: '#1a1a2e' }}>
                {commandPreview.action === 'draft' && commandPreview.params.to && (
                  <>
                    <div><strong>To:</strong> {String(commandPreview.params.to)}</div>
                    <div><strong>Subject:</strong> {String(commandPreview.params.subject || '')}</div>
                    <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>{String(commandPreview.params.body || '')}</div>
                  </>
                )}
                {commandPreview.action === 'create' && (
                  <>
                    <div><strong>Title:</strong> {String(commandPreview.params.title || commandPreview.params.summary || '')}</div>
                    {commandPreview.params.description && <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>{String(commandPreview.params.description)}</div>}
                    {commandPreview.params.date && <div><strong>Date:</strong> {String(commandPreview.params.date)}</div>}
                    {commandPreview.params.time && <div><strong>Time:</strong> {String(commandPreview.params.time)}</div>}
                  </>
                )}
                {commandPreview.action === 'add' && (
                  <>
                    <div><strong>Task:</strong> {String(commandPreview.params.title || '')}</div>
                    {commandPreview.params.notes && <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>{String(commandPreview.params.notes)}</div>}
                    {commandPreview.params.due && <div><strong>Due:</strong> {String(commandPreview.params.due)}</div>}
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="halo-btn send-btn"
                  onClick={handleConfirmCommand}
                  style={{ flex: 1 }}
                >
                  Confirm & Execute
                </button>
                <button
                  className="halo-btn cancel-btn"
                  onClick={handleCancelCommand}
                  style={{ flex: 1, background: '#27272a', color: '#fafafa' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

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
          {aiAnswer && !isThinking && !commandPreview && (
            <div className="halo-answer">
              <div className="halo-answer-text">{aiAnswer}</div>
            </div>
          )}
        </div>
      )}

      {/* Context Panel */}
      {contextOpen && (
        <div className="halo-context-panel">
          <div className="halo-context-header">
            <span>Context</span>
            <button className="halo-close" onClick={toggleContext}>×</button>
          </div>
          <label className="halo-context-checkbox">
            <input
              type="checkbox"
              checked={includeContextForAI}
              onChange={(e) => setIncludeContextPreference(e.target.checked)}
            />
            <span>Include context when I ask AI</span>
          </label>
          <div className="halo-context-actions">
            <button type="button" className="halo-btn" onClick={refreshSearches}>Refresh</button>
            <button type="button" className="halo-btn" onClick={clearContext}>Clear</button>
          </div>
          <div className="halo-context-lists">
            <div className="halo-context-section">
              <div className="halo-context-section-title">Recent searches</div>
              <ul className="halo-context-list">
                {(contextSnapshot?.recent_searches ?? []).slice(0, 15).map((s, i) => (
                  <li key={`${s.url}-${i}`} className="halo-context-item">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="halo-context-link">{s.query}</a>
                  </li>
                ))}
                {(!contextSnapshot?.recent_searches?.length) && <li className="halo-context-empty">No recent searches</li>}
              </ul>
            </div>
            <div className="halo-context-section">
              <div className="halo-context-section-title">AI chat snippets</div>
              <ul className="halo-context-list">
                {contextSnapshot?.recent_ai_chats && Object.entries(contextSnapshot.recent_ai_chats).flatMap(([host, msgs]) =>
                  ((msgs ?? []) as Array<{ role: string; text: string }>).slice(0, 5).map((m, i) => (
                    <li key={`${host}-${i}`} className="halo-context-item halo-context-chat">
                      <span className="halo-context-role">{m.role}:</span> {m.text.slice(0, 120)}{m.text.length > 120 ? "…" : ""}
                    </li>
                  ))
                )}
                {(!contextSnapshot?.recent_ai_chats || Object.keys(contextSnapshot.recent_ai_chats).length === 0) && (
                  <li className="halo-context-empty">No AI chat snippets</li>
                )}
              </ul>
            </div>
          </div>
          <button type="button" className="halo-btn halo-btn-suggest" onClick={suggestFromContext} disabled={isSuggesting}>
            {isSuggesting ? "Suggesting…" : "Suggest"}
          </button>
          {suggestionText && (
            <div className="halo-context-suggestion">
              <div className="halo-context-suggestion-title">Next steps</div>
              <div className="halo-context-suggestion-text">{suggestionText}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
