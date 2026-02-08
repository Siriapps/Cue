import {
  addRecentSearch,
  buildContextBlob,
  clearCueContext,
  getCueContext,
  mergeChatMessages,
  setRecentSearches,
  type CueContext,
  type SearchEntry,
} from "../shared/context_store";

const API_BASE = "http://localhost:8000";
const WS_BASE = "ws://localhost:8000";

// Go Live state
let mediaRecorder: MediaRecorder | null = null;
let recordingStream: MediaStream | null = null;
let puppeteerSocket: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const CHUNK_MS = 5000;

// Session Recording state
type SessionState = "idle" | "recording" | "paused";
let sessionState: SessionState = "idle";
let sessionInfo: {
  title: string;
  url: string;
  startTime: number;
} | null = null;

// Session Audio Capture is now handled directly in content script (session_recorder.ts)
// using navigator.mediaDevices.getUserMedia() - no offscreen documents needed!

// ================== LOCAL CONTEXT (SEARCH + AI CHAT) ==================

const CONTEXT_MAINTENANCE_KEY = "cue_context_maintenance_v1";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function filterContextToToday(ctx: CueContext): CueContext {
  const cutoff = startOfTodayMs();
  const recent_searches = (ctx.recent_searches || []).filter((s) => (s.visitedAt || 0) >= cutoff);

  const recent_ai_chats: Record<string, any[]> = {};
  for (const [host, msgs] of Object.entries(ctx.recent_ai_chats || {})) {
    const filtered = (msgs || []).filter((m: any) => (m.capturedAt || 0) >= cutoff);
    if (filtered.length) recent_ai_chats[host] = filtered;
  }

  return {
    ...ctx,
    recent_searches,
    recent_ai_chats,
  };
}

async function ensureWeeklyContextClear(): Promise<void> {
  try {
    if (!chrome?.storage?.local) return;

    const lastClearedAt = await new Promise<number>((resolve) => {
      chrome.storage.local.get([CONTEXT_MAINTENANCE_KEY], (res) => {
        const v = res?.[CONTEXT_MAINTENANCE_KEY]?.lastClearedAt;
        resolve(typeof v === "number" ? v : 0);
      });
    });

    const now = Date.now();
    if (!lastClearedAt || now - lastClearedAt >= ONE_WEEK_MS) {
      await clearCueContext();
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({
          [CONTEXT_MAINTENANCE_KEY]: { lastClearedAt: now },
        }, () => resolve());
      });
    }
  } catch {
    // ignore
  }
}

// Run maintenance on background startup.
ensureWeeklyContextClear().catch(() => {
  // ignore
});

function inferSearchEngine(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h.includes("google")) return "google";
  if (h.includes("bing")) return "bing";
  if (h.includes("duckduckgo")) return "duckduckgo";
  if (h.includes("yahoo")) return "yahoo";
  if (h.includes("brave")) return "brave";
  if (h.includes("perplexity")) return "perplexity";
  return hostname;
}

function extractSearchQueryFromUrl(rawUrl: string): { query: string; engine?: string } | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();

    // Common query params across search engines.
    const params = u.searchParams;
    const candidates = [
      params.get("q"),
      params.get("query"),
      params.get("p"),
      params.get("text"),
      params.get("search"),
    ].filter(Boolean) as string[];

    const query = (candidates[0] || "").trim();
    if (!query) return null;

    // Very light filtering to avoid capturing non-search pages.
    const isLikelySearch =
      host.includes("google") ||
      host.includes("bing") ||
      host.includes("duckduckgo") ||
      host.includes("yahoo") ||
      host.includes("brave") ||
      host.includes("perplexity") ||
      u.pathname.includes("/search");

    if (!isLikelySearch) return null;

    return { query, engine: inferSearchEngine(host) };
  } catch {
    return null;
  }
}

async function refreshRecentSearchesFromHistory(max: number = 50): Promise<SearchEntry[]> {
  // We pull more than max because not all history items are searches.
  const MAX_SCAN = 2000;

  if (!chrome?.history?.search) {
    return [];
  }

  const items = await new Promise<chrome.history.HistoryItem[]>((resolve) => {
    chrome.history.search({ text: "", maxResults: MAX_SCAN }, (results) => resolve(results || []));
  });

  const collected: SearchEntry[] = [];
  for (const item of items) {
    const url = item.url || "";
    const parsed = extractSearchQueryFromUrl(url);
    if (!parsed) continue;

    collected.push({
      query: parsed.query,
      engine: parsed.engine,
      url,
      visitedAt: item.lastVisitTime || Date.now(),
    });

    if (collected.length >= max) break;
  }

  return collected;
}

// Best-effort incremental capture for search queries.
try {
  if (chrome?.history?.onVisited) {
    chrome.history.onVisited.addListener((item) => {
      const url = item.url || "";
      const parsed = extractSearchQueryFromUrl(url);
      if (!parsed) return;

      addRecentSearch({
        query: parsed.query,
        engine: parsed.engine,
        url,
        visitedAt: item.lastVisitTime || Date.now(),
      }).catch(() => {
        // ignore
      });
    });
  }
} catch {
  // ignore
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] || "";
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

// ================== SESSION RECORDING ==================

async function startSessionRecording(info: { title: string; url: string; startTime: number }) {
  if (sessionState !== "idle") {
    console.warn("[cue] Session already in progress");
    return;
  }

  sessionInfo = info;
  sessionState = "recording";
  console.log("[cue] Session recording started for:", info.title);
}

function pauseSessionRecording() {
  if (sessionState !== "recording") return;
  sessionState = "paused";
  console.log("[cue] Session paused");
}

function resumeSessionRecording() {
  if (sessionState !== "paused") return;
  sessionState = "recording";
  console.log("[cue] Session resumed");
}

async function stopSessionRecording(payload: {
  title: string;
  url: string;
  duration: number;
  audio_base64: string;
  mime_type: string;
}): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  // Note: With mic recording in content script, we don't need to check session state
  // The audio is already captured, so we can send it directly to the backend

  try {
    console.log("[cue] Saving session, audio size:", payload.audio_base64.length, "base64 chars");
    
    // Send to backend for transcription and save
    const response = await fetch(`${API_BASE}/sessions/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        source_url: payload.url,
        duration_seconds: payload.duration,
        audio_base64: payload.audio_base64,
        mime_type: payload.mime_type,
      }),
    });

    // Check if response is OK before parsing JSON
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        // Try to get error message from response body
        const errorText = await response.text();
        if (errorText) {
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorJson.detail || errorMessage;
          } catch {
            // If not JSON, use the text as error message
            errorMessage = errorText.substring(0, 200); // Limit length
          }
        }
      } catch (e) {
        // If we can't read the error, use status text
        console.error("[cue] Failed to read error response:", e);
      }
      
      console.error("[cue] Backend error:", errorMessage);
      sessionState = "idle";
      sessionInfo = null;
      // Surface error in UI (e.g. dashboard/popup can show toast)
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "SESSION_SAVE_ERROR", payload: { error: errorMessage } }, () => {
            if (chrome.runtime.lastError) {
              // Content script may not be on this page; ignore
            }
          });
        }
      } catch {
        // Ignore
      }
      return { success: false, error: errorMessage };
    }

    // Parse JSON response
    let data;
    try {
      const responseText = await response.text();
      if (!responseText) {
        throw new Error("Empty response from server");
      }
      data = JSON.parse(responseText);
    } catch (parseError: any) {
      console.error("[cue] Failed to parse JSON response:", parseError);
      console.error("[cue] Response text:", await response.text());
      sessionState = "idle";
      sessionInfo = null;
      return { success: false, error: `Invalid JSON response: ${parseError.message}` };
    }

    // Cleanup (only if we had session info)
    if (sessionInfo) {
      sessionInfo = null;
      sessionState = "idle";
    }

    // Notify content script
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "SESSION_SAVED", payload: data }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn("[cue] Failed to notify content script:", chrome.runtime.lastError.message);
          }
        });
      }
    } catch (messageError: any) {
      console.warn("[cue] Failed to send message to content script:", messageError.message);
    }

    console.log("[cue] Session saved successfully:", data.sessionId);
    return { success: true, sessionId: data.sessionId };
  } catch (error: any) {
    console.error("[cue] Failed to save session:", error);
    sessionState = "idle";
    sessionInfo = null;
    return { success: false, error: error.message || "Unknown error occurred" };
  }
}

// ================== GO LIVE (Real-time) ==================

function connectPuppeteerSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    if (puppeteerSocket?.readyState === WebSocket.OPEN) {
      resolve(puppeteerSocket);
      return;
    }

    const ws = new WebSocket(`${WS_BASE}/ws/puppeteer`);

    ws.onopen = () => {
      console.log("Puppeteer WebSocket connected");
      reconnectAttempts = 0;
      puppeteerSocket = ws;
      resolve(ws);
    };

    ws.onerror = (error) => {
      console.error("Puppeteer WebSocket error:", error);
      reject(error);
    };

    ws.onclose = () => {
      console.log("Puppeteer WebSocket closed");
      puppeteerSocket = null;

      if (mediaRecorder && mediaRecorder.state === "recording" && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        setTimeout(() => connectPuppeteerSocket().catch(console.error), 1000 * reconnectAttempts);
      }
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab?.id) {
          if (data.type === "pose") {
            chrome.tabs.sendMessage(tab.id, { type: "POSE_UPDATE", payload: data });
          } else if (data.type === "diagram") {
            chrome.tabs.sendMessage(tab.id, { type: "DIAGRAM_RECEIVED", payload: data });
          } else if (data.type === "motion") {
            chrome.tabs.sendMessage(tab.id, { type: "MOTION_DETECTED", payload: data });
          }
        }
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e);
      }
    };
  });
}

async function sendChunkViaWebSocket(blob: Blob, mimeType: string) {
  try {
    const audio_base64 = await blobToBase64(blob);

    if (puppeteerSocket?.readyState === WebSocket.OPEN) {
      puppeteerSocket.send(JSON.stringify({
        type: "audio_chunk",
        audio_base64,
        mime_type: mimeType,
        timestamp: Date.now(),
      }));
    } else {
      await sendChunkToBackendHttp(audio_base64, mimeType);
    }
  } catch (error) {
    console.error("Failed to send audio chunk:", error);
  }
}

async function sendChunkToBackendHttp(audio_base64: string, mimeType: string) {
  const response = await fetch(`${API_BASE}/process_audio_chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio_base64, mime_type: mimeType }),
  });
  const data = await response.json();

  if (data?.type === "diagram" || data?.type === "pose" || data?.type === "motion") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const messageType = data.type === "diagram" ? "DIAGRAM_RECEIVED" :
                          data.type === "pose" ? "POSE_UPDATE" : "MOTION_DETECTED";
      chrome.tabs.sendMessage(tab.id, { type: messageType, payload: data });
    }
  }
}

async function startGoLiveCapture() {
  try {
    await connectPuppeteerSocket();
  } catch (error) {
    console.warn("Could not establish WebSocket, will use HTTP fallback:", error);
  }

  return new Promise<void>((resolve, reject) => {
    chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
      if (chrome.runtime.lastError || !stream) {
        reject(new Error(chrome.runtime.lastError?.message || "Failed to start tab capture"));
        return;
      }

      recordingStream = stream;
      const options = { mimeType: "audio/webm;codecs=opus" };

      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch {
        mediaRecorder = new MediaRecorder(stream);
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          sendChunkViaWebSocket(event.data, mediaRecorder?.mimeType || "audio/webm");
        }
      };

      mediaRecorder.start(CHUNK_MS);

      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "GO_LIVE_STARTED" });
        }
      });

      resolve();
    });
  });
}

function stopGoLiveCapture() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
  mediaRecorder = null;

  if (puppeteerSocket) {
    puppeteerSocket.close();
    puppeteerSocket = null;
  }

  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "GO_LIVE_STOPPED" });
    }
  });
}

// ================== MESSAGE HANDLERS ==================

type CueMessage =
  | { type: "CONTEXT_GET_SNAPSHOT" }
  | { type: "CONTEXT_REFRESH_SEARCHES" }
  | { type: "CONTEXT_CLEAR" }
  | { type: "CONTEXT_SAVE_CHAT_MESSAGES"; payload: { hostname: string; url?: string; messages: Array<{ role?: string; text: string }> } }
  | { type: "CONTEXT_SUGGEST"; payload?: { goal?: string } }
  | { type: "CONTEXT_AUTO_SUGGEST"; payload?: { goal?: string; count?: number } }
  | { type: string; [k: string]: any };

chrome.runtime.onMessage.addListener((message: CueMessage, _sender, sendResponse) => {
  // ===== Context (local-only) =====
  if (message.type === "CONTEXT_GET_SNAPSHOT") {
    (async () => {
      try {
        const ctx = await getCueContext();
        sendResponse({ success: true, context: ctx });
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type === "CONTEXT_REFRESH_SEARCHES") {
    (async () => {
      try {
        const searches = await refreshRecentSearchesFromHistory(50);
        const ctx = await setRecentSearches(searches, 50);
        sendResponse({ success: true, context: ctx });
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type === "CONTEXT_CLEAR") {
    (async () => {
      try {
        await clearCueContext();
        const ctx = await getCueContext();
        sendResponse({ success: true, context: ctx });
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (message.type === "CONTEXT_SAVE_CHAT_MESSAGES") {
    (async () => {
      try {
        const host = message.payload?.hostname || "";
        const url = message.payload?.url;
        const incoming = (message.payload?.messages || []).map((m) => ({
          role: (m.role as any) || "unknown",
          text: m.text,
          url,
        }));

        const ctx = await mergeChatMessages(host, incoming, 50);
        sendResponse({ success: true, context: ctx });
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // Suggest using explicit-send context (manual)
  if (message.type === "CONTEXT_SUGGEST") {
    (async () => {
      try {
        await ensureWeeklyContextClear();
        const ctx = await getCueContext();
        const context_blob = buildContextBlob(ctx);

        const goal = message.payload?.goal || "Generate 3 helpful, concrete suggestions the user can take next.";
        const prompt = [
          "You are a proactive assistant inside a browser extension.",
          "Using the user's recent search queries and recent AI chat messages, propose 3 suggestions.",
          "Each suggestion should be one short paragraph and include a specific next step.",
          "If the context is empty, respond with a single question asking what the user is working on.",
          "",
          `Goal: ${goal}`,
        ].join("\n");

        const response = await fetch(`${API_BASE}/ask_ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: prompt, context_blob }),
        });

        const data = await response.json();
        sendResponse(data);
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // Suggest using today's context (auto popup)
  if (message.type === "CONTEXT_AUTO_SUGGEST") {
    (async () => {
      try {
        await ensureWeeklyContextClear();
        const raw = await getCueContext();
        const today = filterContextToToday(raw);
        const context_blob = buildContextBlob(today, { maxSearches: 50, maxMessagesPerHost: 50 });

        const count = Math.min(Math.max(message.payload?.count || 5, 1), 10);
        const goal = message.payload?.goal || "Generate helpful suggestions the user can take next based on today's activity.";

        const prompt = [
          "You are a proactive assistant inside a browser extension.",
          `Using the user's activity from today only (searches + AI chats), propose ${count} suggestions.`,
          "Return a numbered list 1..N. Keep each suggestion short and concrete, with a next step.",
          "If the context is empty, return a single question asking what the user is working on.",
          "",
          `Goal: ${goal}`,
        ].join("\n");

        const response = await fetch(`${API_BASE}/ask_ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: prompt, context_blob }),
        });

        const data = await response.json();
        sendResponse(data);
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  // Library
  if (message.type === "OPEN_LIBRARY") {
    try {
      chrome.tabs.create({ url: message.url || "http://localhost:3001" });
      sendResponse({ success: true });
    } catch (error: any) {
      console.error("[cue] Failed to open library:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Indicates we will send a response asynchronously
  }

  // Ask AI
  if (message.type === "ASK_AI") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        const includeContext = !!message.includeContext;
        let context_blob: string | undefined;
        if (includeContext) {
          const ctx = await getCueContext();
          context_blob = buildContextBlob(ctx);
        }

        const conversationHistory = message.conversationHistory;
        const body = {
          query: message.query,
          page_title: tab?.title || "",
          current_url: tab?.url || "",
          selected_text: message.selectedText || "",
          ...(context_blob ? { context_blob } : {}),
          ...(conversationHistory?.length ? { conversation_history: conversationHistory } : {}),
        };

        const response = await fetch(`${API_BASE}/ask_ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();

        sendResponse(data);

        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "AI_ANSWER", payload: data });
        }
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Prism Summarize
  if (message.type === "PRISM_SUMMARIZE") {
    fetch(`${API_BASE}/summarize_context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((res) => res.json())
      .then(async (data) => {
        sendResponse({ status: "ok", data });
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "PRISM_RESULT", payload: data });
        }
      })
      .catch((error) => sendResponse({ status: "error", error: error.message }));
    return true;
  }

  // Session Recording
  if (message.type === "SESSION_START") {
    startSessionRecording(message.payload)
      .then(() => sendResponse({ status: "ok" }))
      .catch((error) => sendResponse({ status: "error", error: error.message }));
    return true;
  }

  // Note: SESSION_START_AUDIO and SESSION_STOP_AUDIO removed - audio is captured
  // directly in content script using navigator.mediaDevices.getUserMedia()

  if (message.type === "SESSION_PAUSE") {
    pauseSessionRecording();
    sendResponse({ status: "ok" });
    return;
  }

  if (message.type === "SESSION_RESUME") {
    resumeSessionRecording();
    sendResponse({ status: "ok" });
    return;
  }

  if (message.type === "SESSION_STOP") {
    stopSessionRecording(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // Go Live
  if (message.type === "GO_LIVE_START") {
    startGoLiveCapture()
      .then(() => sendResponse({ status: "ok" }))
      .catch((error) => sendResponse({ status: "error", error: error.message }));
    return true;
  }

  if (message.type === "GO_LIVE_STOP") {
    stopGoLiveCapture();
    sendResponse({ status: "ok" });
    return;
  }
});
