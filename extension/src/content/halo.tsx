import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { startGoLive, stopGoLive } from "./go_live";
import { summarizePage } from "./readability";
import { startMicRecording, pauseMicRecording, resumeMicRecording, stopMicRecording } from "./session_recorder";
import { startVoiceActivation, stopVoiceActivation, isVoiceActivationListening, getWakePhrase, setWakePhrase, isSpeechRecognitionSupported } from "./voice_activation";
import { openVoiceChatPopup } from "./voice_chat_popup";
import type { CueContext } from "../shared/context_store";

const LIBRARY_URL = "http://localhost:3001";
const INCLUDE_CONTEXT_STORAGE_KEY = "cue_include_context_for_ai_v1";
const AUTO_SUGGEST_DELAY_KEY = "cue_auto_suggest_delay_ms_v1";
const LAST_SUGGESTIONS_KEY = "cue_last_suggestions_v1";
const VOICE_ACTIVATION_ENABLED_KEY = "cue_voice_activation_enabled_v1";

type SessionState = "idle" | "recording" | "paused";

export function HaloStrip(): React.JSX.Element {
  // UI State
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  // Local context UI
  const [contextSnapshot, setContextSnapshot] = useState<CueContext | null>(null);
  const [includeContextForAI, setIncludeContextForAI] = useState(false);
  const [autoSuggestDelayMs, setAutoSuggestDelayMs] = useState(60_000);
  const [suggestionText, setSuggestionText] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [savedSuggestions, setSavedSuggestions] = useState<string[]>([]);

  // Session Recording State
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Go Live State
  const [isLive, setIsLive] = useState(false);

  // Voice Activation State
  const [voiceActivationEnabled, setVoiceActivationEnabled] = useState(false);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [wakePhrase, setWakePhraseState] = useState("hey cue help me");
  const [wakePhraseInput, setWakePhraseInput] = useState("");

  const loadContextSnapshot = useCallback(() => {
    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage({ type: "CONTEXT_GET_SNAPSHOT" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.success && response?.context) {
          setContextSnapshot(response.context as CueContext);
        }
      });
    } catch {
      // ignore
    }
  }, []);

  const loadSavedSuggestions = useCallback(() => {
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get([LAST_SUGGESTIONS_KEY], (res) => {
        const saved = res?.[LAST_SUGGESTIONS_KEY];
        if (saved?.items?.length) {
          setSavedSuggestions(saved.items.slice(0, 5));
        }
      });
    } catch {
      // ignore
    }
  }, []);

  // Load collapsed state + include-context preference + voice activation
  useEffect(() => {
    try {
      if (!chrome?.storage?.local) {
        throw new Error("Extension context invalidated");
      }
      chrome.storage.local.get(["haloCollapsed", INCLUDE_CONTEXT_STORAGE_KEY, AUTO_SUGGEST_DELAY_KEY, VOICE_ACTIVATION_ENABLED_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.error("[cue] Failed to load collapsed state:", chrome.runtime.lastError.message);
          return;
        }
        if (result.haloCollapsed !== undefined) {
          setIsCollapsed(result.haloCollapsed);
        }
        if (result[INCLUDE_CONTEXT_STORAGE_KEY] !== undefined) {
          setIncludeContextForAI(!!result[INCLUDE_CONTEXT_STORAGE_KEY]);
        }
        if (result[AUTO_SUGGEST_DELAY_KEY] !== undefined && typeof result[AUTO_SUGGEST_DELAY_KEY] === "number") {
          setAutoSuggestDelayMs(result[AUTO_SUGGEST_DELAY_KEY]);
        }
        // Load voice activation state
        if (result[VOICE_ACTIVATION_ENABLED_KEY] !== undefined) {
          const enabled = !!result[VOICE_ACTIVATION_ENABLED_KEY];
          setVoiceActivationEnabled(enabled);
          if (enabled && isSpeechRecognitionSupported()) {
            startVoiceActivation().then((started) => {
              setIsVoiceListening(started);
            });
          }
        }
      });

      // Load wake phrase
      getWakePhrase().then((phrase) => {
        setWakePhraseState(phrase);
        setWakePhraseInput(phrase);
      });
    } catch (error: any) {
      console.error("[cue] Extension context invalidated:", error.message);
    }
  }, []);

  // Listen for voice activation events
  useEffect(() => {
    const handleListeningStarted = () => setIsVoiceListening(true);
    const handleListeningStopped = () => setIsVoiceListening(false);

    window.addEventListener("cue:voice-listening-started", handleListeningStarted);
    window.addEventListener("cue:voice-listening-stopped", handleListeningStopped);

    return () => {
      window.removeEventListener("cue:voice-listening-started", handleListeningStarted);
      window.removeEventListener("cue:voice-listening-stopped", handleListeningStopped);
    };
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

  const toggleContext = () => {
    setContextOpen((prev) => {
      const next = !prev;
      if (next) {
        loadContextSnapshot();
        loadSavedSuggestions();
      } else {
        setSuggestionText(null);
        setIsSuggesting(false);
      }
      return next;
    });
  };

  const setIncludeContextPreference = (next: boolean) => {
    setIncludeContextForAI(next);
    try {
      if (!chrome?.storage?.local) {
        throw new Error("Extension context invalidated");
      }
      chrome.storage.local.set({ [INCLUDE_CONTEXT_STORAGE_KEY]: next }, () => {
        // ignore
      });
    } catch {
      // ignore
    }
  };

  const setAutoSuggestDelayPreference = (nextMs: number) => {
    const ms = Math.max(5_000, nextMs);
    setAutoSuggestDelayMs(ms);
    try {
      if (!chrome?.storage?.local) {
        throw new Error("Extension context invalidated");
      }
      chrome.storage.local.set({ [AUTO_SUGGEST_DELAY_KEY]: ms }, () => {
        // ignore
      });
    } catch {
      // ignore
    }
  };

  const toggleVoiceActivation = async () => {
    // If enabled but not listening (e.g. after no-speech restart failure), click = retry
    if (voiceActivationEnabled && !isVoiceListening) {
      const started = await startVoiceActivation();
      setIsVoiceListening(started);
      return;
    }
    
    const newState = !voiceActivationEnabled;
    setVoiceActivationEnabled(newState);
    
    try {
      if (!chrome?.storage?.local) {
        throw new Error("Extension context invalidated");
      }
      chrome.storage.local.set({ [VOICE_ACTIVATION_ENABLED_KEY]: newState });
    } catch {
      // ignore
    }

    if (newState) {
      const started = await startVoiceActivation();
      setIsVoiceListening(started);
    } else {
      stopVoiceActivation();
      setIsVoiceListening(false);
    }
  };

  const handleWakePhraseChange = async () => {
    const trimmed = wakePhraseInput.trim().toLowerCase();
    if (trimmed && trimmed !== wakePhrase) {
      await setWakePhrase(trimmed);
      setWakePhraseState(trimmed);
    }
  };

  const handleOpenVoiceChat = () => {
    openVoiceChatPopup();
  };

  const refreshSearches = () => {
    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage({ type: "CONTEXT_REFRESH_SEARCHES" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.success && response?.context) {
          setContextSnapshot(response.context as CueContext);
        }
      });
    } catch {
      // ignore
    }
  };

  const clearContext = () => {
    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage({ type: "CONTEXT_CLEAR" }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.success && response?.context) {
          setContextSnapshot(response.context as CueContext);
        }
      });
    } catch {
      // ignore
    }
  };

  const suggestFromContext = () => {
    setIsSuggesting(true);
    setSuggestionText(null);
    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }
      chrome.runtime.sendMessage({ type: "CONTEXT_SUGGEST" }, (response) => {
        setIsSuggesting(false);
        if (chrome.runtime.lastError) {
          setSuggestionText("Extension context invalidated. Please reload the page.");
          return;
        }
        if (response?.success && response?.answer) {
          setSuggestionText(response.answer);
        } else {
          setSuggestionText(response?.error || "Failed to generate suggestions");
        }
      });
    } catch (e: any) {
      setIsSuggesting(false);
      setSuggestionText(e?.message || "Failed to generate suggestions");
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

  const handleAsk = () => {
    if (!query.trim()) return;
    const currentQuery = query.trim();
    setQuery("");
    setIsThinking(true);
    setAiAnswer(null);

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

  // Listen for cue:open-chat event from suggestions
  useEffect(() => {
    const handleOpenChat = (e: CustomEvent<{ prompt: string }>) => {
      const prompt = e.detail?.prompt;
      if (prompt) {
        setChatOpen(true);
        setQuery(prompt);
        // Automatically send the query
        setIsThinking(true);
        setAiAnswer(null);
        try {
          if (!chrome?.runtime?.id) {
            throw new Error("Extension context invalidated");
          }
          chrome.runtime.sendMessage(
            {
              type: "ASK_AI",
              query: prompt,
              selectedText: "",
              includeContext: includeContextForAI,
            },
            (response) => {
              setIsThinking(false);
              if (chrome.runtime.lastError) {
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
          setIsThinking(false);
          setAiAnswer("Extension context invalidated. Please reload the page.");
        }
      }
    };

    window.addEventListener("cue:open-chat", handleOpenChat as EventListener);
    return () => {
      window.removeEventListener("cue:open-chat", handleOpenChat as EventListener);
    };
  }, [includeContextForAI]);

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

        {/* Context Button */}
        <button className="halo-btn context" onClick={toggleContext}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2Zm1 14.93V18h-2v-1.07A8.006 8.006 0 0 1 4.07 13H6.1A6.002 6.002 0 0 0 11 15.9V13h2v2.9A6.002 6.002 0 0 0 17.9 13h2.03A8.006 8.006 0 0 1 13 16.93ZM13 11h-2V6h2Z"/>
          </svg>
          <span>Context</span>
        </button>

        {/* Ask AI Button */}
        <button className="halo-btn ask-ai" onClick={toggleChat}>
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
          <span>Ask AI</span>
        </button>

        {/* Hey Cue Button */}
        <button className="halo-btn ask-ai" onClick={handleOpenVoiceChat} title="Open voice chat (or say your wake phrase)">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
          <span>Hey Cue</span>
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
            <button className="halo-close" onClick={toggleChat}>×</button>
          </div>
          <input
            className="halo-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation(); // Prevent YouTube/page from capturing keys
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

      {/* Context Panel */}
      {contextOpen && (
        <div className="halo-chat halo-context">
          <div className="halo-chat-header">
            <span>Context</span>
            <button className="halo-close" onClick={toggleContext}>×</button>
          </div>

          <div className="context-row">
            <label className="context-toggle">
              <input
                type="checkbox"
                checked={includeContextForAI}
                onChange={(e) => setIncludeContextPreference(e.target.checked)}
              />
              <span>Include context when I ask AI</span>
            </label>
          </div>

          <div className="context-row">
            <label className="context-toggle">
              <span>Auto suggestions after</span>
              <select
                className="context-select"
                value={autoSuggestDelayMs}
                onChange={(e) => setAutoSuggestDelayPreference(parseInt(e.target.value, 10))}
              >
                <option value={30_000}>30 seconds</option>
                <option value={60_000}>1 minute</option>
                <option value={120_000}>2 minutes</option>
              </select>
              <span>on search pages</span>
            </label>
          </div>

          {/* Voice Activation Section */}
          {isSpeechRecognitionSupported() && (
            <div className="context-section">
              <div className="context-section-title">
                <span>🎤 Voice Activation</span>
              </div>
              
              <div className="context-row" style={{ gap: '12px', flexDirection: 'column', alignItems: 'stretch' }}>
                {/* Toggle Voice Activation */}
                <div
                  className={`voice-activation-toggle ${voiceActivationEnabled ? '' : 'inactive'}`}
                  onClick={toggleVoiceActivation}
                  role="button"
                  tabIndex={0}
                >
                  <div className="voice-activation-dot"></div>
                  <span className="voice-activation-text">
                    {voiceActivationEnabled 
                      ? (isVoiceListening ? 'Listening for wake phrase...' : 'Click to resume listening')
                      : 'Voice activation disabled'
                    }
                  </span>
                </div>

                {/* Wake Phrase Input */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', color: '#374151', whiteSpace: 'nowrap' }}>Wake phrase:</span>
                  <input
                    type="text"
                    className="wake-phrase-input"
                    value={wakePhraseInput}
                    onChange={(e) => setWakePhraseInput(e.target.value)}
                    onBlur={handleWakePhraseChange}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        handleWakePhraseChange();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="hey cue help me"
                  />
                </div>

                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  Say "{wakePhrase}" to open the voice chat popup
                </div>
              </div>
            </div>
          )}

          <div className="context-actions">
            <button className="halo-btn context-action" onClick={refreshSearches}>
              Refresh searches
            </button>
            <button className="halo-btn context-action" onClick={clearContext}>
              Clear
            </button>
            <button className="halo-btn send-btn" onClick={suggestFromContext}>
              Suggest
            </button>
          </div>

          {/* Saved Suggestions Section */}
          {savedSuggestions.length > 0 && (
            <div className="context-section">
              <div className="context-section-title">
                <span>💡 Your Suggestions</span>
              </div>
              <div className="context-suggestions-grid">
                {savedSuggestions.map((s, i) => (
                  <button
                    key={i}
                    className="context-suggestion-card"
                    onClick={() => {
                      setContextOpen(false);
                      setChatOpen(true);
                      setQuery(s);
                      // Auto-send the suggestion
                      setIsThinking(true);
                      setAiAnswer(null);
                      try {
                        if (!chrome?.runtime?.id) {
                          throw new Error("Extension context invalidated");
                        }
                        chrome.runtime.sendMessage(
                          {
                            type: "ASK_AI",
                            query: s,
                            selectedText: "",
                            includeContext: includeContextForAI,
                          },
                          (response) => {
                            setIsThinking(false);
                            if (chrome.runtime.lastError) {
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
                        setIsThinking(false);
                        setAiAnswer("Extension context invalidated. Please reload the page.");
                      }
                    }}
                    title="Click to start chat"
                  >
                    <span className="context-suggestion-number">{i + 1}</span>
                    <span className="context-suggestion-text">{s}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="context-section">
            <div className="context-section-title">Recent searches</div>
            <div className="context-list">
              {(contextSnapshot?.recent_searches || []).slice(0, 10).map((s, idx) => (
                <div key={`${s.url}-${idx}`} className="context-item">
                  {s.query}
                </div>
              ))}
              {(!contextSnapshot?.recent_searches || contextSnapshot.recent_searches.length === 0) && (
                <div className="context-empty">No searches captured yet. Click “Refresh searches”.</div>
              )}
            </div>
          </div>

          <div className="context-section">
            <div className="context-section-title">AI chat snippets</div>
            <div className="context-list">
              {contextSnapshot?.recent_ai_chats && Object.keys(contextSnapshot.recent_ai_chats).length > 0 ? (
                Object.entries(contextSnapshot.recent_ai_chats)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([host, msgs]) => (
                    <div key={host} className="context-host-block">
                      <div className="context-host">{host}</div>
                      {(msgs || []).slice(0, 5).map((m, i) => (
                        <div key={`${host}-${i}`} className="context-item">
                          <span className="context-role">{m.role || "unknown"}:</span> {m.text}
                        </div>
                      ))}
                    </div>
                  ))
              ) : (
                <div className="context-empty">No AI chat messages captured yet (supported: ChatGPT/Gemini/Claude/Perplexity).</div>
              )}
            </div>
          </div>

          {isSuggesting && (
            <div className="halo-answer">
              <div className="halo-thinking">
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                Thinking...
              </div>
            </div>
          )}

          {suggestionText && !isSuggesting && (
            <div className="halo-answer">
              <div className="halo-answer-text">{suggestionText}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
