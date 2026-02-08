import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { pauseVoiceActivation, resumeVoiceActivation } from "./voice_activation";

const VOICE_CHAT_ROOT_ID = "cue-voice-chat-root";
const VOICE_CHAT_CONTAINER_ID = "cue-voice-chat-container";

// Speech Recognition types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export function initVoiceChatPopup(haloStyles: string): void {
  try {
    if (!document.body) return;

    let host = document.getElementById(VOICE_CHAT_ROOT_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = VOICE_CHAT_ROOT_ID;
      document.body.appendChild(host);
    }

    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });

    if (!shadow.querySelector("#cue-voice-chat-styles")) {
      const styleEl = document.createElement("style");
      styleEl.id = "cue-voice-chat-styles";
      styleEl.textContent = haloStyles;
      shadow.appendChild(styleEl);
    }

    let container = shadow.querySelector(`#${VOICE_CHAT_CONTAINER_ID}`) as HTMLElement | null;
    if (!container) {
      container = document.createElement("div");
      container.id = VOICE_CHAT_CONTAINER_ID;
      shadow.appendChild(container);
    }

    // Avoid double-mount
    if ((container as any).__cueVoiceChatMounted) return;
    (container as any).__cueVoiceChatMounted = true;

    const root = createRoot(container);
    root.render(<VoiceChatPopup />);
  } catch (error) {
    console.error("[cue] Failed to initialize voice chat popup:", error);
  }
}

export function VoiceChatPopup(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for voice activation event (triggered by wake phrase)
  useEffect(() => {
    const handleVoiceActivation = () => {
      console.log("[cue] Voice chat popup: received cue:voice-activated");
      // Pause wake phrase listener first
      pauseVoiceActivation();
      
      setIsOpen(true);
      // Auto-start listening when activated by voice - give more time for wake phrase listener to stop
      setTimeout(() => {
        startListening();
      }, 600);
    };

    // Listen for manual open (button click) - don't auto-start mic
    const handleManualOpen = () => {
      setIsOpen(true);
      // Focus input instead of starting mic for manual opens
    };

    window.addEventListener("cue:voice-activated", handleVoiceActivation);
    window.addEventListener("cue:open-voice-chat", handleManualOpen);
    return () => {
      window.removeEventListener("cue:voice-activated", handleVoiceActivation);
      window.removeEventListener("cue:open-voice-chat", handleManualOpen);
    };
  }, []);

  // Focus input when popup opens
  useEffect(() => {
    if (isOpen && inputRef.current && !isListening) {
      inputRef.current.focus();
    }
  }, [isOpen, isListening]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  const startListening = useCallback(() => {
    if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
      console.warn("[cue] Speech recognition not supported");
      return;
    }

    // Stop any existing recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
    }

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionClass();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsListening(true);
      setInterimTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final) {
        setQuery((prev) => (prev + " " + final).trim());
        setInterimTranscript("");
      } else {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = (event) => {
      console.warn("[cue] Voice input error:", event.error);
      setIsListening(false);
      setInterimTranscript("");
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (error) {
      console.error("[cue] Failed to start voice input:", error);
      setIsListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
    }
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    stopListening();
    setQuery("");
    setInterimTranscript("");
    setAiAnswer(null);
    setIsThinking(false);
    setConversationHistory([]);
    
    // Resume wake phrase listener after popup closes
    setTimeout(() => {
      resumeVoiceActivation().catch((e) => {
        console.warn("[cue] Failed to resume voice activation:", e);
      });
    }, 400);
  }, [stopListening]);

  const handleSend = useCallback(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    // Add to conversation history
    setConversationHistory((prev) => [...prev, { role: "user", text: trimmedQuery }]);
    setQuery("");
    setIsThinking(true);
    setAiAnswer(null);

    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }

      chrome.runtime.sendMessage(
        {
          type: "ASK_AI",
          query: trimmedQuery,
          selectedText: "",
          includeContext: true,
          conversationHistory: conversationHistory.map((m) => ({ role: m.role, text: m.text })),
        },
        (response) => {
          setIsThinking(false);
          if (chrome.runtime.lastError) {
            const errorMsg = "Extension context invalidated. Please reload the page.";
            setAiAnswer(errorMsg);
            setConversationHistory((prev) => [...prev, { role: "assistant", text: errorMsg }]);
            return;
          }
          if (response?.success && response?.answer) {
            setAiAnswer(response.answer);
            setConversationHistory((prev) => [...prev, { role: "assistant", text: response.answer }]);
          } else {
            const errorMsg = response?.error || "Failed to get AI response";
            setAiAnswer(errorMsg);
            setConversationHistory((prev) => [...prev, { role: "assistant", text: errorMsg }]);
          }
        }
      );
    } catch (error: any) {
      setIsThinking(false);
      const errorMsg = error?.message || "Failed to get AI response";
      setAiAnswer(errorMsg);
      setConversationHistory((prev) => [...prev, { role: "assistant", text: errorMsg }]);
    }
  }, [query, conversationHistory]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return <></>;

  return (
    <div className="voice-chat-overlay" onClick={handleClose}>
      <div className="voice-chat-popup" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="voice-chat-header">
          <div className="voice-chat-title">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="voice-chat-icon">
              <circle cx="12" cy="12" r="10" fill="url(#voiceChatGrad)" />
              <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="14" r="2" fill="white"/>
              <defs>
                <linearGradient id="voiceChatGrad" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#6366f1"/>
                  <stop offset="1" stopColor="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
            <span>Hey Cue!</span>
          </div>
          <button className="voice-chat-close" onClick={handleClose} title="Close (Esc)">
            ×
          </button>
        </div>

        {/* Conversation History */}
        {conversationHistory.length > 0 && (
          <div className="voice-chat-history">
            {conversationHistory.map((msg, idx) => (
              <div key={idx} className={`voice-chat-message ${msg.role}`}>
                <div className="voice-chat-message-role">
                  {msg.role === "user" ? "You" : "Cue"}
                </div>
                <div className="voice-chat-message-text">{msg.text}</div>
              </div>
            ))}
          </div>
        )}

        {/* Thinking Indicator */}
        {isThinking && (
          <div className="voice-chat-thinking">
            <span className="thinking-dot"></span>
            <span className="thinking-dot"></span>
            <span className="thinking-dot"></span>
            <span>Thinking...</span>
          </div>
        )}

        {/* Input Area */}
        <div className="voice-chat-input-area">
          <div className="voice-chat-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="voice-chat-input"
              placeholder={isListening ? "Listening..." : "Type or speak your question..."}
              value={query + (interimTranscript ? " " + interimTranscript : "")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onKeyUp={(e) => e.stopPropagation()}
              onKeyPress={(e) => e.stopPropagation()}
              disabled={isListening}
            />
            
            {/* Microphone Button */}
            <button
              className={`voice-chat-mic-btn ${isListening ? "listening" : ""}`}
              onClick={toggleListening}
              title={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              )}
            </button>
          </div>

          {/* Voice Input Indicator */}
          {isListening && (
            <div className="voice-chat-listening-indicator">
              <div className="voice-wave">
                <span></span>
                <span></span>
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span className="voice-listening-text">Listening... Speak now</span>
            </div>
          )}

          {/* Send Button */}
          <button
            className="voice-chat-send-btn"
            onClick={handleSend}
            disabled={!query.trim() || isThinking}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
            </svg>
            <span>Send</span>
          </button>
        </div>

        {/* Footer hint */}
        <div className="voice-chat-footer">
          <span>Press Esc to close • Click mic or type your message</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Programmatically open the voice chat popup
 */
export function openVoiceChatPopup(): void {
  // Pause wake phrase listener before opening
  pauseVoiceActivation();
  window.dispatchEvent(new CustomEvent("cue:open-voice-chat"));
}
