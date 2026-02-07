import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { startGoLive, stopGoLive } from "./go_live";
import { summarizePage } from "./readability";
import { startMicRecording, pauseMicRecording, resumeMicRecording, stopMicRecording } from "./session_recorder";
import type { CueContext } from "../shared/context_store";

const LIBRARY_URL = import.meta.env.VITE_LIBRARY_URL || "http://localhost:3001";

// Fallback clipboard copy using execCommand for older browsers or when Clipboard API fails
function fallbackCopyToClipboard(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    console.log("[cue] Copied via fallback execCommand");
  } catch (e) {
    console.error("[cue] Fallback clipboard copy failed:", e);
  }
  document.body.removeChild(textarea);
}

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

  // Predicted tasks popup state
  type SuggestedTask = {
    id?: string;
    title: string;
    description: string;
    service?: string | null;
    action?: string | null;
    params?: Record<string, unknown> | null;
  };
  const [predictedTasks, setPredictedTasks] = useState<SuggestedTask[]>([]);
  const [executingTaskId, setExecutingTaskId] = useState<string | null>(null);
  const [showTaskPanel, setShowTaskPanel] = useState(false);

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastLibraryUrl, setToastLibraryUrl] = useState<string | null>(null);

  // Edit task modal state
  const [editingTask, setEditingTask] = useState<SuggestedTask | null>(null);
  const [editFormData, setEditFormData] = useState<{
    to?: string;
    subject?: string;
    body?: string;
    title?: string;
    date?: string;
    time?: string;
    description?: string;
  }>({});

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
      // Handle predicted tasks popup
      if (message.type === "PREDICTED_TASKS_POPUP" && message.payload) {
        console.log("[cue] Received PREDICTED_TASKS_POPUP:", message.payload);
        const p = message.payload as { tasks?: SuggestedTask[] };
        if (p.tasks && p.tasks.length > 0) {
          console.log(`[cue] Setting ${p.tasks.length} predicted tasks`);
          setPredictedTasks(p.tasks.slice(0, 5)); // Max 5 tasks
        }
      }
      // Handle task execution result
      if (message.type === "TASK_EXECUTED" && message.payload) {
        const p = message.payload as { success?: boolean; taskId?: string; error?: string; open_url?: string; message?: string; promptCopied?: boolean };
        setExecutingTaskId(null);
        if (p.success && p.taskId) {
          // Remove completed task from list
          setPredictedTasks((prev) => prev.filter((t) => t.id !== p.taskId));
        }
        // Show toast notification if prompt was copied or there's a message
        if (p.promptCopied && p.message) {
          setToastMessage(p.message);
          setToastLibraryUrl(null);
          setTimeout(() => setToastMessage(null), 4000);
        } else if (p.error) {
          setToastMessage("Action couldn't be completed. Go to the Library to see your sessions and tasks, or retry from there.");
          setToastLibraryUrl(LIBRARY_URL);
          setTimeout(() => { setToastMessage(null); setToastLibraryUrl(null); }, 6000);
        }
      }
      // Handle clipboard copy request (for AI chat auto-open)
      if (message.type === "COPY_TO_CLIPBOARD" && message.payload) {
        const p = message.payload as { text?: string };
        if (p.text) {
          // Try modern Clipboard API first, fallback to execCommand
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(p.text).then(() => {
              console.log("[cue] Copied prompt to clipboard");
            }).catch(() => {
              // Fallback to execCommand on failure
              fallbackCopyToClipboard(p.text);
            });
          } else {
            fallbackCopyToClipboard(p.text);
          }
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // After 10s on page, request "next step" and show notification (once per load)
  const nextStepRequested = useRef(false);
  useEffect(() => {
    if (nextStepRequested.current || !chrome?.runtime?.id) return;
    const t = window.setTimeout(() => {
      nextStepRequested.current = true;
      chrome.runtime.sendMessage({ type: "CONTEXT_SUGGEST" }, (response: { success?: boolean; error?: string; tasks?: { title?: string }[] }) => {
        if (chrome.runtime.lastError) return;
        if (response?.success && response.tasks?.length) {
          const title = response.tasks[0].title || "Suggested task";
          setToastMessage(`Your next step: ${title}`);
          setToastLibraryUrl(null);
          setTimeout(() => setToastMessage(null), 5000);
        } else if (response?.error) {
          setToastMessage("Go to the Library to see your sessions and tasks, or retry from there.");
          setToastLibraryUrl(LIBRARY_URL);
          setTimeout(() => { setToastMessage(null); setToastLibraryUrl(null); }, 6000);
        }
      });
    }, 10000);
    return () => clearTimeout(t);
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
          suggested_params: commandPreview.params || {},
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
            setAiAnswer(`Error: ${response?.error || "Command failed"}\n\nGo to the Library to see your sessions and tasks, or retry from there.`);
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

  // Predicted Tasks handlers
  const handleAcceptTask = (task: SuggestedTask) => {
    setExecutingTaskId(task.id || null);

    // Notify background that a task was accepted (decrement active count)
    try {
      chrome.runtime.sendMessage({ type: "TASK_ACTION", action: "accepted", count: 1 });
    } catch { /* Extension context invalidated */ }

    // If no service/action, treat as AI research task - open Gemini with the prompt
    if (!task.service || !task.action) {
      const prompt = task.description || task.title || "Help me with this task";
      try {
        chrome.runtime.sendMessage({
          type: "EXECUTE_SUGGESTED_TASK",
          service: "gemini_chat",
          action: "open",
          params: { prompt },
          taskId: task.id,
        });
      } catch (e) {
        console.error("[cue] Failed to execute task:", e);
        setExecutingTaskId(null);
      }
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: "EXECUTE_SUGGESTED_TASK",
        service: task.service,
        action: task.action,
        params: task.params || {},
        taskId: task.id,
      });
    } catch (e) {
      console.error("[cue] Failed to execute task:", e);
      setExecutingTaskId(null);
    }
  };

  const handleDismissTask = (taskId: string | undefined) => {
    // Notify background that a task was dismissed
    try {
      chrome.runtime.sendMessage({ type: "TASK_ACTION", action: "dismissed", count: 1 });
    } catch { /* Extension context invalidated */ }

    if (!taskId) {
      // No ID, just remove from local state
      setPredictedTasks((prev) => prev.slice(1));
      return;
    }
    // Mark as dismissed in backend and remove from local state
    setPredictedTasks((prev) => prev.filter((t) => t.id !== taskId));
    try {
      fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"}/suggested_tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      }).catch(() => {});
    } catch {
      // Ignore errors
    }
  };

  const handleDismissAllTasks = () => {
    // Notify background that all tasks were dismissed
    try {
      chrome.runtime.sendMessage({ type: "TASK_ACTION", action: "dismissed", count: predictedTasks.length });
    } catch { /* Extension context invalidated */ }

    // Dismiss all tasks
    predictedTasks.forEach((task) => {
      if (task.id) {
        try {
          fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:8000"}/suggested_tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "dismissed" }),
          }).catch(() => {});
        } catch {
          // Ignore
        }
      }
    });
    setPredictedTasks([]);
  };

  // Edit task handlers
  const handleEditTask = (task: SuggestedTask) => {
    setEditingTask(task);
    // Pre-fill form data from task params
    const params = task.params || {};
    setEditFormData({
      to: (params.to as string) || "",
      subject: (params.subject as string) || "",
      body: (params.body as string) || (params.message as string) || "",
      title: (params.title as string) || (params.summary as string) || task.title || "",
      date: (params.date as string) || "",
      time: (params.time as string) || (params.start as string) || "",
      description: (params.description as string) || task.description || "",
    });
  };

  const handleEditFormChange = (field: string, value: string) => {
    setEditFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditSubmit = () => {
    if (!editingTask) return;

    // Build updated params based on service type
    const updatedParams: Record<string, unknown> = { ...(editingTask.params || {}) };

    if (editingTask.service === "gmail") {
      if (editFormData.to) updatedParams.to = editFormData.to;
      if (editFormData.subject) updatedParams.subject = editFormData.subject;
      if (editFormData.body) updatedParams.body = editFormData.body;
    } else if (editingTask.service === "calendar") {
      if (editFormData.title) updatedParams.summary = editFormData.title;
      if (editFormData.date) updatedParams.date = editFormData.date;
      if (editFormData.time) updatedParams.start = editFormData.time;
      if (editFormData.description) updatedParams.description = editFormData.description;
    } else if (editingTask.service === "tasks") {
      if (editFormData.title) updatedParams.title = editFormData.title;
      if (editFormData.description) updatedParams.notes = editFormData.description;
    } else {
      // Generic: update description/prompt
      if (editFormData.description) updatedParams.prompt = editFormData.description;
    }

    // Execute the task with updated params
    const updatedTask = { ...editingTask, params: updatedParams };
    setEditingTask(null);
    handleAcceptTask(updatedTask);
  };

  const handleEditCancel = () => {
    setEditingTask(null);
    setEditFormData({});
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

        {/* Notification Bell with Task Count */}
        <div
          className="halo-notifications"
          onClick={() => {
            const opening = !showTaskPanel;
            setShowTaskPanel(opening);
            // Notify background that user viewed suggestions (starts cooldown)
            if (opening && predictedTasks.length > 0) {
              try {
                chrome.runtime.sendMessage({ type: "USER_VIEWED_SUGGESTIONS" });
              } catch { /* Extension context invalidated */ }
            }
          }}
        >
          <svg className="notification-bell" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
          </svg>
          {predictedTasks.length > 0 && (
            <span className="notification-badge">{predictedTasks.length}</span>
          )}
        </div>

      </div>

      {/* Task Panel Dropdown */}
      {showTaskPanel && predictedTasks.length > 0 && (
        <div className="halo-task-panel">
          <div className="task-panel-header">
            <span className="task-panel-title">Suggested Tasks</span>
            <button className="dismiss-all-btn" onClick={() => { handleDismissAllTasks(); setShowTaskPanel(false); }} title="Dismiss all">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div className="task-panel-list">
            {predictedTasks.map((task, index) => (
              <div key={task.id || index} className="task-panel-card">
                <div className="task-card-content">
                  <div className="task-card-title">{task.title}</div>
                  {task.description && (
                    <div className="task-card-description">{task.description}</div>
                  )}
                  {task.service && (
                    <span className="task-card-service">{task.service}</span>
                  )}
                </div>
                <div className="task-card-actions">
                  <button
                    className="task-edit-btn"
                    onClick={() => handleEditTask(task)}
                    title="Edit details"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <button
                    className="task-accept-btn"
                    onClick={() => handleAcceptTask(task)}
                    disabled={executingTaskId === task.id}
                  >
                    {executingTaskId === task.id ? "..." : "Accept"}
                  </button>
                  <button
                    className="task-dismiss-btn"
                    onClick={() => handleDismissTask(task.id)}
                    title="Dismiss"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="halo-toast">
          <span>{toastMessage}</span>
          {toastLibraryUrl && (
            <a href={toastLibraryUrl} target="_blank" rel="noopener noreferrer" className="halo-toast-library-link" onClick={() => { setToastMessage(null); setToastLibraryUrl(null); }}>
              Open Library
            </a>
          )}
          <button onClick={() => { setToastMessage(null); setToastLibraryUrl(null); }}>×</button>
        </div>
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <div className="halo-edit-modal-overlay" onClick={handleEditCancel}>
          <div className="halo-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="halo-edit-modal-header">
              <span>Edit Task</span>
              <button onClick={handleEditCancel}>×</button>
            </div>
            <div className="halo-edit-modal-body">
              <div className="halo-edit-task-title">{editingTask.title}</div>

              {/* Gmail-specific fields */}
              {editingTask.service === "gmail" && (
                <>
                  <label className="halo-edit-label">
                    To:
                    <input
                      type="email"
                      value={editFormData.to || ""}
                      onChange={(e) => handleEditFormChange("to", e.target.value)}
                      placeholder="recipient@example.com"
                      className="halo-edit-input"
                    />
                  </label>
                  <label className="halo-edit-label">
                    Subject:
                    <input
                      type="text"
                      value={editFormData.subject || ""}
                      onChange={(e) => handleEditFormChange("subject", e.target.value)}
                      placeholder="Email subject"
                      className="halo-edit-input"
                    />
                  </label>
                  <label className="halo-edit-label">
                    Message:
                    <textarea
                      value={editFormData.body || ""}
                      onChange={(e) => handleEditFormChange("body", e.target.value)}
                      placeholder="Email body"
                      className="halo-edit-textarea"
                      rows={3}
                    />
                  </label>
                </>
              )}

              {/* Calendar-specific fields */}
              {editingTask.service === "calendar" && (
                <>
                  <label className="halo-edit-label">
                    Event Title:
                    <input
                      type="text"
                      value={editFormData.title || ""}
                      onChange={(e) => handleEditFormChange("title", e.target.value)}
                      placeholder="Meeting title"
                      className="halo-edit-input"
                    />
                  </label>
                  <label className="halo-edit-label">
                    Date:
                    <input
                      type="date"
                      value={editFormData.date || ""}
                      onChange={(e) => handleEditFormChange("date", e.target.value)}
                      className="halo-edit-input"
                    />
                  </label>
                  <label className="halo-edit-label">
                    Time:
                    <input
                      type="time"
                      value={editFormData.time || ""}
                      onChange={(e) => handleEditFormChange("time", e.target.value)}
                      className="halo-edit-input"
                    />
                  </label>
                  <label className="halo-edit-label">
                    Description:
                    <textarea
                      value={editFormData.description || ""}
                      onChange={(e) => handleEditFormChange("description", e.target.value)}
                      placeholder="Event description"
                      className="halo-edit-textarea"
                      rows={2}
                    />
                  </label>
                </>
              )}

              {/* Tasks-specific fields */}
              {editingTask.service === "tasks" && (
                <>
                  <label className="halo-edit-label">
                    Task Title:
                    <input
                      type="text"
                      value={editFormData.title || ""}
                      onChange={(e) => handleEditFormChange("title", e.target.value)}
                      placeholder="Task title"
                      className="halo-edit-input"
                    />
                  </label>
                  <label className="halo-edit-label">
                    Notes:
                    <textarea
                      value={editFormData.description || ""}
                      onChange={(e) => handleEditFormChange("description", e.target.value)}
                      placeholder="Task notes"
                      className="halo-edit-textarea"
                      rows={2}
                    />
                  </label>
                </>
              )}

              {/* Generic/AI chat fields */}
              {(!editingTask.service || !["gmail", "calendar", "tasks"].includes(editingTask.service)) && (
                <label className="halo-edit-label">
                  Prompt/Description:
                  <textarea
                    value={editFormData.description || ""}
                    onChange={(e) => handleEditFormChange("description", e.target.value)}
                    placeholder="Edit the prompt or description"
                    className="halo-edit-textarea"
                    rows={4}
                  />
                </label>
              )}
            </div>
            <div className="halo-edit-modal-footer">
              <button className="halo-edit-cancel-btn" onClick={handleEditCancel}>Cancel</button>
              <button className="halo-edit-submit-btn" onClick={handleEditSubmit}>Execute</button>
            </div>
          </div>
        </div>
      )}

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
            <div className="halo-context-section">
              <div className="halo-context-section-title">Recent sites</div>
              <ul className="halo-context-list">
                {((contextSnapshot as any)?.recent_sites ?? []).slice(0, 15).map((s: any, i: number) => (
                  <li key={`site-${i}`} className="halo-context-item halo-context-site">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="halo-context-link">
                      {s.title || s.domain}
                    </a>
                    <span className="halo-context-duration">{Math.round(s.durationMs / 1000)}s</span>
                  </li>
                ))}
                {(!(contextSnapshot as any)?.recent_sites?.length) && <li className="halo-context-empty">No recent sites</li>}
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

      {/* Predicted Tasks Popup is now rendered outside Shadow DOM - see predicted_tasks_popup.tsx */}
    </div>
  );
}
