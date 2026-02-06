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

// ================== OFFSCREEN DOCUMENT MANAGEMENT ==================
let creatingOffscreenDocument: Promise<void> | null = null;

async function setupOffscreenDocument(path: string) {
  // Check if offscreen document already exists using getContexts
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'] as any,
    documentUrls: [path]
  });

  // Always close and recreate to ensure we have the latest version
  // This prevents caching issues with offscreen documents
  if (existingContexts.length > 0) {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'background/index.ts:48',message:'Closing existing offscreen document',data:{documentId:existingContexts[0].documentId},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      await chrome.offscreen.closeDocument({ documentId: existingContexts[0].documentId } as any);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'background/index.ts:52',message:'Offscreen document closed successfully',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      // Wait a moment for Chrome to fully close it
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'background/index.ts:57',message:'Error closing offscreen document',data:{error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      // Ignore errors if document is already closed
    }
  }

  // Create offscreen document
  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
  } else {
    creatingOffscreenDocument = (async () => {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'background/index.ts:62',message:'Creating new offscreen document',data:{path},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        await chrome.offscreen.createDocument({
          url: path,
          reasons: ['USER_MEDIA'] as any,
          justification: 'Wake word detection and audio capture from tab'
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'background/index.ts:70',message:'Offscreen document created successfully',data:{path},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
      } catch (error: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/23f45ddd-244c-4bbc-b1ce-d6e960bc0c31',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'background/index.ts:73',message:'Error creating offscreen document',data:{error:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        if (!error.message.startsWith('Only a single offscreen')) {
          console.error('[cue] Failed to create offscreen document:', error);
          throw error;
        }
      }
    })();

    try {
      await creatingOffscreenDocument;
    } finally {
      creatingOffscreenDocument = null;
    }
  }
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Forward offscreen logs to main console
  if (message.type === "OFFSCREEN_LOG") {
    const logMethod = message.level === 'error' ? console.error : message.level === 'warn' ? console.warn : console.log;
    logMethod(message.message);
    return;
  }

  // --- Wake Word ---
  if (message.type === "START_WAKE_WORD") {
    console.log("[cue background] START_WAKE_WORD received, setting up offscreen document...");
    setupOffscreenDocument("offscreen.html")
      .then(() => {
        console.log("[cue background] Offscreen document ready, sending START_WAKE_WORD message...");
        // Longer delay to ensure offscreen document script is fully loaded
        setTimeout(() => {
          console.log("[cue background] Sending message to offscreen document...");
          chrome.runtime.sendMessage({
            type: "START_WAKE_WORD",
            target: "offscreen"
          }, (response) => {
            console.log("[cue background] Response from offscreen:", response);
            if (chrome.runtime.lastError) {
              console.error("[cue background] Error sending to offscreen:", chrome.runtime.lastError.message);
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            if (!response) {
              console.error("[cue background] No response from offscreen document!");
              sendResponse({ success: false, error: "No response from offscreen - document may not be loaded" });
              return;
            }
            if (response && !response.success) {
              const err = response.error || "";
              console.error("[cue background] Offscreen returned error:", err);
              if (err === "PERMISSION_DENIED" || err.includes("permission") || err.includes("not-allowed") || err.includes("Permission denied") || err.includes("not found") || err.includes("device") || err.includes("NotFoundError")) {
                console.warn("[cue] Wake word permission/device issue. Opening permission page.");
                chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
              }
            } else {
              console.log("[cue background] Wake word detection started successfully!");
            }
            sendResponse(response || { success: false, error: "No response from offscreen" });
          });
        }, 500); // Increased delay to 500ms
      })
      .catch((error) => {
        console.error("[cue background] Failed to setup offscreen document:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === "STOP_WAKE_WORD") {
    chrome.runtime.sendMessage({
      type: "STOP_WAKE_WORD",
      target: "offscreen"
    });
    sendResponse({ success: true });
    return;
  }

  if (message.type === "WAKE_WORD_DETECTED") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: "WAKE_WORD_DETECTED" });
      }
    });
    return;
  }

  // Check if a specific tab is active
  if (message.type === "CHECK_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      chrome.tabs.getCurrent().then((currentTab) => {
        sendResponse({ isActive: activeTab?.id === currentTab?.id });
      }).catch(() => {
        // If getCurrent fails (content script context), check by URL
        if (message.tabId) {
          sendResponse({ isActive: activeTab?.id === message.tabId });
        } else {
          sendResponse({ isActive: false });
        }
      });
    });
    return true; // Indicates async response
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
        const context = {
          query: message.query,
          page_title: tab?.title || "",
          current_url: tab?.url || "",
          selected_text: message.selectedText || "",
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

  // Permission Granted (from permission.html)
  if (message.type === "PERMISSION_GRANTED") {
    console.log("[cue] Permission granted, retrying wake word detection...");
    
    // Small delay to ensure permission is fully registered
    setTimeout(() => {
      // Try to restart wake word detection in offscreen document
      chrome.runtime.sendMessage({
        type: "START_WAKE_WORD",
        target: "offscreen"
      }, (response) => {
        if (response && response.success) {
          console.log("[cue] Wake word detection restarted successfully after permission grant");
        } else {
          console.warn("[cue] Failed to restart wake word after permission grant:", response?.error);
        }
      });
      
      // Broadcast to all tabs to retry
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "PERMISSION_UPDATED" }, () => {
              // Ignore errors - tab might not have content script
              if (chrome.runtime.lastError) {
                // Expected for some tabs
              }
            });
          }
        }
      });
    }, 500);
    
    sendResponse({ success: true });
    return;
  }
});
