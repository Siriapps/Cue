import {
  getCueContext,
  setRecentSearches,
  addRecentSearch,
  clearCueContext,
  buildContextBlob,
  mergeChatMessages,
  type CueContext,
  type SearchEntry,
} from "../shared/context_store";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const WS_BASE = import.meta.env.VITE_WS_BASE_URL || "ws://localhost:8000";

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

// ================== Chrome Identity OAuth ==================

async function loginWithGoogle(): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const result = await chrome.identity.getAuthToken({ interactive: true });
    const token: string | undefined =
      typeof result === "string" ? result : (result as { token?: string })?.token;
    if (!token) {
      return { success: false, error: "No token returned" };
    }

    // Store token in chrome.storage.local for later use
    await chrome.storage.local.set({
      googleToken: token,
      tokenTimestamp: Date.now(),
    });
    console.log("[cue] Google token stored in chrome.storage.local");

    return { success: true, token };
  } catch (error: any) {
    console.error("[cue] Google login failed:", error);
    return { success: false, error: error?.message || "Login failed" };
  }
}

async function logoutGoogle(): Promise<void> {
  chrome.identity.clearAllCachedAuthTokens();
  // Also clear stored token
  await chrome.storage.local.remove(["googleToken", "tokenTimestamp"]);
  console.log("[cue] Google logout: tokens cleared");
}

// Check if user is logged in
async function isLoggedIn(): Promise<boolean> {
  const stored = await chrome.storage.local.get(["googleToken"]);
  return !!stored.googleToken;
}

// Get a fresh token (refreshes if needed)
async function getFreshToken(): Promise<string | null> {
  try {
    // Always get a fresh token from Chrome identity to ensure it's valid
    const result = await chrome.identity.getAuthToken({ interactive: false });
    const token: string | undefined =
      typeof result === "string" ? result : (result as { token?: string })?.token;

    if (token) {
      // Update stored token
      await chrome.storage.local.set({
        googleToken: token,
        tokenTimestamp: Date.now(),
      });
      console.log("[cue] Fresh token obtained");
      return token;
    }

    // If no token and not interactive, try interactive login
    console.log("[cue] No cached token, attempting interactive login");
    const loginResult = await loginWithGoogle();
    return loginResult.token || null;
  } catch (error: any) {
    console.error("[cue] Failed to get fresh token:", error);
    return null;
  }
}

// ================== Context Store (GetContext) ==================

function inferSearchEngine(url: string): string | undefined {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("google.")) return "Google";
    if (host.includes("bing.")) return "Bing";
    if (host.includes("duckduckgo.")) return "DuckDuckGo";
    if (host.includes("yahoo.")) return "Yahoo";
    if (host.includes("ecosia.")) return "Ecosia";
    return undefined;
  } catch {
    return undefined;
  }
}

function extractSearchQueryFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const q = u.searchParams.get("q") || u.searchParams.get("query") || u.searchParams.get("p") || u.searchParams.get("text");
    if (q && q.trim()) return q.trim();
    if (host.includes("google.")) return u.searchParams.get("q")?.trim() ?? null;
    if (host.includes("bing.")) return u.searchParams.get("q")?.trim() ?? null;
    if (host.includes("duckduckgo.")) return u.searchParams.get("q")?.trim() ?? null;
    if (host.includes("yahoo.")) return u.searchParams.get("p")?.trim() ?? null;
    return null;
  } catch {
    return null;
  }
}

async function refreshRecentSearchesFromHistory(): Promise<CueContext> {
  const maxItems = 50;
  const items = await new Promise<chrome.history.HistoryItem[]>((resolve) => {
    chrome.history.search({ text: "", maxResults: 200, startTime: 0 }, resolve);
  });
  const entries: SearchEntry[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.url) continue;
    const query = extractSearchQueryFromUrl(item.url);
    if (!query) continue;
    const key = `${query}@@${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      query,
      url: item.url,
      engine: inferSearchEngine(item.url),
      visitedAt: item.lastVisitTime ?? Date.now(),
    });
    if (entries.length >= maxItems) break;
  }
  return setRecentSearches(entries, maxItems);
}

chrome.history.onVisited.addListener(async (item) => {
  if (!item.url) return;
  const query = extractSearchQueryFromUrl(item.url);
  if (!query) return;
  await addRecentSearch({
    query,
    url: item.url,
    engine: inferSearchEngine(item.url),
    visitedAt: item.lastVisitTime ?? Date.now(),
  });
});

// Session Audio Capture is now handled directly in content script (session_recorder.ts)
// using navigator.mediaDevices.getUserMedia() - no offscreen documents needed!

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
    await sendChunkBase64(audio_base64, mimeType);
  } catch (error) {
    console.error("Failed to send audio chunk:", error);
  }
}

async function sendChunkBase64(audio_base64: string, mimeType: string): Promise<void> {
  try {
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

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab");
  }

  try {
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id! }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError?.message || "getMediaStreamId failed"));
        } else {
          resolve(id);
        }
      });
    });

    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Tab audio capture for Go Live",
    });

    await new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        chrome.runtime.sendMessage(
          { target: "offscreen", type: "START_CAPTURE", streamId, includeMic: false },
          (r) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError?.message));
            } else if (r?.success) {
              resolve();
            } else {
              reject(new Error(r?.error || "START_CAPTURE failed"));
            }
          }
        );
      }, 150);
    });

    chrome.tabs.sendMessage(tab.id, { type: "GO_LIVE_STARTED" });
    return;
  } catch (offscreenError) {
    console.warn("[cue] Offscreen capture failed, falling back to tabCapture.capture:", offscreenError);
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

      chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
        if (t?.id) chrome.tabs.sendMessage(t.id, { type: "GO_LIVE_STARTED" });
      });

      resolve();
    });
  });
}

async function stopGoLiveCapture() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
  mediaRecorder = null;

  try {
    const hasOffscreen = await chrome.offscreen.hasDocument();
    if (hasOffscreen) {
      chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_CAPTURE" }, () => {
        chrome.offscreen.closeDocument();
      });
    }
  } catch {
    // ignore
  }

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  // Context (GetContext)
  if (message.type === "CONTEXT_GET_SNAPSHOT") {
    getCueContext().then((ctx) => sendResponse({ success: true, snapshot: ctx })).catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }
  if (message.type === "CONTEXT_REFRESH_SEARCHES") {
    refreshRecentSearchesFromHistory().then((ctx) => sendResponse({ success: true, snapshot: ctx })).catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }
  if (message.type === "CONTEXT_CLEAR") {
    clearCueContext().then(() => sendResponse({ success: true })).catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }
  if (message.type === "CONTEXT_SAVE_CHAT_MESSAGES") {
    const { hostname, url, messages } = message.payload || {};
    if (!hostname || !Array.isArray(messages)) {
      sendResponse({ success: false, error: "Missing hostname or messages" });
      return true;
    }
    mergeChatMessages(
      hostname,
      messages.map((m: { role?: string; text: string }) => ({ role: (m.role || "unknown") as "user" | "assistant" | "system" | "unknown", text: m.text, url })),
    )
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: String(e) }));
    return true;
  }
  if (message.type === "CONTEXT_SUGGEST") {
    (async () => {
      try {
        const ctx = await getCueContext();
        const blob = buildContextBlob(ctx);
        if (!blob.trim()) {
          sendResponse({ success: false, error: "No context to suggest from" });
          return;
        }
        const res = await fetch(`${API_BASE}/suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context_blob: blob }),
        });
        const data = await res.json();
        if (data.success && data.answer) {
          sendResponse({ success: true, suggestion: data.answer });
        } else {
          sendResponse({ success: false, error: data.error || "Suggest failed" });
        }
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || "Suggest failed" });
      }
    })();
    return true;
  }

  // Ask AI (with @mention command support)
  if (message.type === "ASK_AI") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const query = message.query || "";

        // Check for @mention commands (@gmail, @calendar, @tasks, @docs, @drive, @sheets)
        const mentionMatch = query.match(/^@(gmail|calendar|tasks|docs|drive|sheets)\s+(.+)/i);

        if (mentionMatch) {
          // Route to /execute_command endpoint
          const service = mentionMatch[1].toLowerCase();
          const command = mentionMatch[2];

          // Get fresh token for authentication (ensures token is valid)
          const userToken = message.confirm ? await getFreshToken() : (await chrome.storage.local.get(["googleToken"])).googleToken || "";

          const response = await fetch(`${API_BASE}/execute_command`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              service,
              command,
              user_token: userToken,
              confirm: message.confirm || false, // Preview by default
              page_title: tab?.title ?? "",
              current_url: tab?.url ?? "",
              selected_text: message.selectedText ?? "",
              user_display_name: message.userDisplayName ?? "",
              user_email: message.userEmail ?? "",
            }),
          });
          const data = await response.json();

          // Send response with command-specific type
          const responseData = {
            ...data,
            type: "command",
            service,
            original_query: query,
          };

          sendResponse(responseData);

          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { type: "COMMAND_RESULT", payload: responseData });
          }
        } else {
          // Regular Ask AI request
          let contextBlob = "";
          if (message.includeContext) {
            const ctx = await getCueContext();
            contextBlob = buildContextBlob(ctx);
          }
          const context = {
            query,
            page_title: tab?.title ?? "",
            current_url: tab?.url ?? "",
            selected_text: message.selectedText ?? "",
            user_display_name: message.userDisplayName ?? "",
            user_email: message.userEmail ?? "",
            context_blob: contextBlob || undefined,
          };

          const response = await fetch(`${API_BASE}/ask_ai`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(context),
          });
          const data = await response.json();

          sendResponse(data);

          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, { type: "AI_ANSWER", payload: data });
          }
        }
      } catch (error: any) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // Execute confirmed command
  if (message.type === "EXECUTE_COMMAND") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // Get fresh token to ensure it's valid
        const userToken = await getFreshToken();

        if (!userToken) {
          sendResponse({ success: false, error: "Please sign in with Google first.", requires_auth: true });
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "COMMAND_EXECUTED",
              payload: { success: false, error: "Please sign in with Google first." },
            });
          }
          return;
        }

        const response = await fetch(`${API_BASE}/execute_command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service: message.service,
            command: message.command,
            user_token: userToken,
            confirm: true, // Execute for real
            page_title: tab?.title ?? message.pageTitle ?? "",
            current_url: tab?.url ?? message.currentUrl ?? "",
            selected_text: message.selectedText ?? "",
            user_display_name: message.userDisplayName ?? "",
            user_email: message.userEmail ?? "",
          }),
        });
        const data = await response.json();

        sendResponse(data);

        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, { type: "COMMAND_EXECUTED", payload: data });
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

  if (message.type === "AUDIO_CHUNK") {
    sendChunkBase64(message.chunk, message.mimeType || "audio/webm").then(() => sendResponse({ ok: true }));
    return true;
  }

  // Google OAuth
  if (message.type === "GOOGLE_LOGIN") {
    loginWithGoogle()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error?.message }));
    return true;
  }

  if (message.type === "GOOGLE_LOGOUT") {
    logoutGoogle()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error?.message }));
    return true;
  }

  // Check login status
  if (message.type === "CHECK_LOGIN") {
    isLoggedIn()
      .then((loggedIn) => sendResponse({ loggedIn }))
      .catch(() => sendResponse({ loggedIn: false }));
    return true;
  }
});
