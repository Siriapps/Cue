import {
  getCueContext,
  setRecentSearches,
  addRecentSearch,
  addRecentSite,
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
  // If the search result is in the active tab, start a 10s dwell timer
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.id && tab.url && tab.url === item.url) {
      startPageDwellTimer(tab.id, tab.url);
    }
  });
  // Check for context change after search (triggers if category changed + cooldown elapsed)
  checkContextAndTrigger(item.url, "search_query");
});

// ================== AUTO-SUGGEST TRIGGERS ==================
// Smart context-based triggering: only suggest when domain category changes + 5-min cooldown

// Domain category mapping (local, no API calls needed)
const DOMAIN_CATEGORIES: Record<string, string> = {
  // Coding
  "github.com": "coding",
  "stackoverflow.com": "coding",
  "leetcode.com": "coding",
  "codepen.io": "coding",
  "codesandbox.io": "coding",
  "replit.com": "coding",
  "gitlab.com": "coding",
  "bitbucket.org": "coding",
  "npmjs.com": "coding",
  "pypi.org": "coding",
  // Email
  "gmail.com": "email",
  "mail.google.com": "email",
  "outlook.com": "email",
  "outlook.live.com": "email",
  "mail.yahoo.com": "email",
  // Calendar
  "calendar.google.com": "calendar",
  "outlook.office.com": "calendar",
  // Docs/Productivity
  "docs.google.com": "docs",
  "sheets.google.com": "docs",
  "slides.google.com": "docs",
  "drive.google.com": "docs",
  "notion.so": "docs",
  "figma.com": "docs",
  // Social
  "twitter.com": "social",
  "x.com": "social",
  "linkedin.com": "social",
  "facebook.com": "social",
  "reddit.com": "social",
  // Shopping
  "amazon.com": "shopping",
  "ebay.com": "shopping",
  "etsy.com": "shopping",
  // Video
  "youtube.com": "video",
  "netflix.com": "video",
  "twitch.tv": "video",
  // AI/Research
  "chat.openai.com": "ai",
  "gemini.google.com": "ai",
  "claude.ai": "ai",
  "perplexity.ai": "ai",
  // News
  "news.ycombinator.com": "news",
  "techcrunch.com": "news",
  "bbc.com": "news",
  "cnn.com": "news",
};

// ================== SUGGESTION STATE MACHINE ==================
// States: ACTIVE -> COOLDOWN -> INTENT_CHECK -> LOCKOUT -> ACTIVE (or PIVOT reset)

type SuggestionState = "active" | "cooldown" | "intent_check" | "lockout";
let suggestionState: SuggestionState = "active";
let lastSuggestCategory = "";
let lastAutoSuggestTime = 0;
let lastSuggestedTopicKeywords: string[] = [];
let lockoutStartTime = 0;

// Timing constants
const AUTO_SUGGEST_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes cooldown after user interaction
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes lockout if same topic
const PAGE_DWELL_TIME_MS = 10000; // 10 seconds on page can trigger
const MAX_SUGGESTIONS_PER_BATCH = 5; // Show max 5 tasks per suggestion

// Session task limit - max 50 tasks per session, decrement when user accepts
let sessionTaskCount = 0;
const MAX_SESSION_TASKS = 50;

// Active task gating - don't generate new tasks while user has pending ones
let activeTaskCount = 0;
const MAX_ACTIVE_TASKS = 5;

// Global cooldown: prevent ANY suggest_tasks call within configurable time of the last one
let lastGlobalSuggestTime = 0;
let GLOBAL_SUGGEST_COOLDOWN_MS = 30_000;

// Load user-configured suggestion frequency from storage
try {
  chrome.storage.local.get(["cue_suggest_frequency"], (result) => {
    if (result.cue_suggest_frequency) {
      GLOBAL_SUGGEST_COOLDOWN_MS = Number(result.cue_suggest_frequency) * 1000;
      console.log(`[cue] Suggest cooldown set to ${GLOBAL_SUGGEST_COOLDOWN_MS}ms from settings`);
    }
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.cue_suggest_frequency?.newValue) {
      GLOBAL_SUGGEST_COOLDOWN_MS = Number(changes.cue_suggest_frequency.newValue) * 1000;
      console.log(`[cue] Suggest cooldown updated to ${GLOBAL_SUGGEST_COOLDOWN_MS}ms`);
    }
  });
} catch { /* ignore if storage unavailable */ }

// Per-tab timers for page dwell time
const pageDwellTimers: Record<number, ReturnType<typeof setTimeout>> = {};
const tabUrls: Record<number, string> = {};

// ================== URL TRAJECTORY TRACKING ==================
// Track last 10 URLs with metadata for deep context

type URLTrajectoryEntry = {
  url: string;
  title: string;
  domain: string;
  category: string;
  timestamp: number;
  durationMs?: number;
};

const urlTrajectory: URLTrajectoryEntry[] = [];
const MAX_TRAJECTORY_SIZE = 10;
let lastTrajectoryUpdate = 0;

function addToTrajectory(url: string, title: string) {
  const now = Date.now();

  // Update duration of previous entry and save to CueContext if >10s
  if (urlTrajectory.length > 0) {
    const prev = urlTrajectory[urlTrajectory.length - 1];
    prev.durationMs = now - prev.timestamp;

    // Save to CueContext if user stayed >10 seconds (addRecentSite handles the threshold)
    if (prev.durationMs >= 10000) {
      addRecentSite({
        url: prev.url,
        title: prev.title,
        domain: prev.domain,
        visitedAt: prev.timestamp,
        durationMs: prev.durationMs,
      }).catch(() => {});
    }
  }

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace("www.", "");
    const category = getDomainCategory(url);

    // Don't add duplicate consecutive URLs
    if (urlTrajectory.length > 0 && urlTrajectory[urlTrajectory.length - 1].url === url) {
      return;
    }

    urlTrajectory.push({
      url,
      title: title || domain,
      domain,
      category,
      timestamp: now,
    });

    // Keep only last MAX_TRAJECTORY_SIZE entries
    while (urlTrajectory.length > MAX_TRAJECTORY_SIZE) {
      urlTrajectory.shift();
    }

    lastTrajectoryUpdate = now;

    // Store in chrome.storage for persistence
    chrome.storage.local.set({ urlTrajectory: urlTrajectory.slice() });
  } catch {
    // Invalid URL, skip
  }
}

function getTrajectoryContext(): string {
  if (urlTrajectory.length === 0) return "";

  const lines = urlTrajectory.map((entry, i) => {
    const ago = Math.round((Date.now() - entry.timestamp) / 60000);
    const duration = entry.durationMs ? ` (${Math.round(entry.durationMs / 1000)}s)` : "";
    return `${i + 1}. [${entry.category}] ${entry.title}${duration} - ${ago}m ago`;
  });

  return `Active Browsing Trajectory (last ${urlTrajectory.length} pages):\n${lines.join("\n")}`;
}

// Extract keywords from URL trajectory for topic detection
function extractTrajectoryKeywords(): string[] {
  const keywords: string[] = [];

  urlTrajectory.forEach((entry) => {
    // Add category
    keywords.push(entry.category);

    // Extract words from title
    const titleWords = entry.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    keywords.push(...titleWords.slice(0, 5));

    // Extract path keywords
    try {
      const path = new URL(entry.url).pathname;
      const pathWords = path
        .replace(/[^a-z0-9]/gi, " ")
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      keywords.push(...pathWords.slice(0, 3));
    } catch { /* ignore */ }
  });

  // Deduplicate and return most common
  const freq: Record<string, number> = {};
  keywords.forEach((k) => { freq[k] = (freq[k] || 0) + 1; });

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);
}

// Check if current topic matches last suggested topic (for lockout)
function isTopicSimilar(currentKeywords: string[], lastKeywords: string[]): boolean {
  if (lastKeywords.length === 0) return false;

  const matches = currentKeywords.filter((k) => lastKeywords.includes(k));
  const similarity = matches.length / Math.max(currentKeywords.length, lastKeywords.length);

  return similarity > 0.4; // 40% keyword overlap = same topic
}

// Load trajectory from storage on startup
chrome.storage.local.get(["urlTrajectory"], (result) => {
  if (result.urlTrajectory && Array.isArray(result.urlTrajectory)) {
    urlTrajectory.push(...result.urlTrajectory.slice(-MAX_TRAJECTORY_SIZE));
    console.log(`[cue] Loaded ${urlTrajectory.length} trajectory entries from storage`);
  }
});

// Get domain category from URL
function getDomainCategory(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    // Check exact match first
    if (DOMAIN_CATEGORIES[hostname]) {
      return DOMAIN_CATEGORIES[hostname];
    }
    // Check if any key is contained in hostname (e.g., "mail.google.com" contains "google.com")
    for (const [domain, category] of Object.entries(DOMAIN_CATEGORIES)) {
      if (hostname.includes(domain) || hostname.endsWith("." + domain)) {
        return category;
      }
    }
    return "general";
  } catch {
    return "general";
  }
}

// Check if we should trigger auto-suggest based on enhanced state machine
function shouldTriggerSuggestion(url: string): boolean {
  const category = getDomainCategory(url);
  const now = Date.now();
  const currentKeywords = extractTrajectoryKeywords();

  // State machine logic
  switch (suggestionState) {
    case "cooldown": {
      // In cooldown - check if 2 minutes have passed
      if (now - lastAutoSuggestTime < AUTO_SUGGEST_COOLDOWN_MS) {
        const remaining = Math.round((AUTO_SUGGEST_COOLDOWN_MS - (now - lastAutoSuggestTime)) / 1000);
        console.log(`[cue] State: COOLDOWN - ${remaining}s remaining`);
        return false;
      }

      // Cooldown expired - move to intent check
      suggestionState = "intent_check";
      console.log("[cue] State: COOLDOWN -> INTENT_CHECK");
      // Fall through to intent_check
    }

    case "intent_check": {
      // Check if topic changed (pivot detection)
      if (!isTopicSimilar(currentKeywords, lastSuggestedTopicKeywords)) {
        // Topic changed! Pivot detected - reset to active
        console.log(`[cue] PIVOT DETECTED - topic changed from [${lastSuggestedTopicKeywords.slice(0, 3).join(", ")}] to [${currentKeywords.slice(0, 3).join(", ")}]`);
        suggestionState = "active";
        // Immediate trigger
        break;
      }

      // Same topic - enter lockout
      console.log(`[cue] Same topic detected - entering LOCKOUT`);
      suggestionState = "lockout";
      lockoutStartTime = now;
      return false;
    }

    case "lockout": {
      // In lockout - check if 5 minutes have passed
      if (now - lockoutStartTime < LOCKOUT_DURATION_MS) {
        const remaining = Math.round((LOCKOUT_DURATION_MS - (now - lockoutStartTime)) / 1000);

        // But still check for pivot detection
        if (!isTopicSimilar(currentKeywords, lastSuggestedTopicKeywords)) {
          console.log(`[cue] PIVOT in LOCKOUT - topic changed, resetting to ACTIVE`);
          suggestionState = "active";
          break;
        }

        console.log(`[cue] State: LOCKOUT - ${remaining}s remaining (suppressing same-topic suggestions)`);
        return false;
      }

      // Lockout expired - back to active
      console.log("[cue] State: LOCKOUT -> ACTIVE");
      suggestionState = "active";
      break;
    }

    case "active":
    default:
      // Active state - check for category change
      break;
  }

  // Now in ACTIVE state - check if context/category changed
  if (category !== lastSuggestCategory) {
    console.log(`[cue] Auto-suggest: context changed from "${lastSuggestCategory}" to "${category}"`);
    lastSuggestCategory = category;
    lastAutoSuggestTime = now;
    lastSuggestedTopicKeywords = currentKeywords.slice();
    suggestionState = "cooldown"; // Enter cooldown after trigger
    return true;
  }

  console.log(`[cue] Auto-suggest: same category "${category}", state: ${suggestionState}`);
  return false;
}

// Called when user views/interacts with suggestions - starts cooldown
function onUserViewedSuggestions() {
  lastAutoSuggestTime = Date.now();
  suggestionState = "cooldown";
  console.log("[cue] User viewed suggestions - entering COOLDOWN");
}

function checkContextAndTrigger(url: string, trigger: string) {
  if (shouldTriggerSuggestion(url)) {
    console.log(`[cue] Triggering auto-suggest (${trigger})`);
    triggerAutoSuggest(trigger);
  }
}

function startPageDwellTimer(tabId: number, url: string) {
  // Clear existing timer for this tab
  if (pageDwellTimers[tabId]) {
    clearTimeout(pageDwellTimers[tabId]);
  }

  // Store URL to detect navigation
  tabUrls[tabId] = url;

  // Start new timer
  pageDwellTimers[tabId] = setTimeout(() => {
    // Check if still on same URL
    if (tabUrls[tabId] === url) {
      checkContextAndTrigger(url, "page_dwell");
    }
    delete pageDwellTimers[tabId];
  }, PAGE_DWELL_TIME_MS);
}

// Listen for tab updates to track page dwell time, URL trajectory, AND check context changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
    // Add to URL trajectory for deep context
    addToTrajectory(tab.url, tab.title || "");

    startPageDwellTimer(tabId, tab.url);
    // Check for context change on page load
    checkContextAndTrigger(tab.url, "context_change");
  }
});

// Clean up timers when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (pageDwellTimers[tabId]) {
    clearTimeout(pageDwellTimers[tabId]);
    delete pageDwellTimers[tabId];
  }
  delete tabUrls[tabId];
});

async function triggerAutoSuggest(trigger: string) {
  // Global cooldown: no suggest_tasks call within 30s of last one
  const now = Date.now();
  if (now - lastGlobalSuggestTime < GLOBAL_SUGGEST_COOLDOWN_MS) {
    console.log(`[cue] Skipping auto-suggest (${trigger}): global cooldown (${Math.round((GLOBAL_SUGGEST_COOLDOWN_MS - (now - lastGlobalSuggestTime)) / 1000)}s left)`);
    return;
  }

  // Don't generate new tasks if user still has pending active tasks
  if (activeTaskCount >= MAX_ACTIVE_TASKS) {
    console.log("[cue] Skipping auto-suggest: user has pending tasks to review");
    return;
  }

  // Check session task limit
  if (sessionTaskCount >= MAX_SESSION_TASKS) {
    console.log("[cue] Session task limit reached (50). Accept a task to generate more.");
    return;
  }

  // Mark global cooldown BEFORE the async call to prevent concurrent triggers
  lastGlobalSuggestTime = now;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const ctx = await getCueContext();
    let contextBlob = buildContextBlob(ctx);

    // Add URL trajectory for deep context
    const trajectoryContext = getTrajectoryContext();
    if (trajectoryContext) {
      contextBlob = `${contextBlob}\n\n${trajectoryContext}`;
    }

    // Fallback: if context is empty, use current page info
    if (!contextBlob.trim()) {
      console.log("[cue] Context empty, using current page only");
      contextBlob = `Currently browsing: ${tab?.title || "Unknown page"}\nURL: ${tab?.url || ""}`;
    }

    console.log(`[cue] Auto-suggest triggered by: ${trigger}`);
    console.log(`[cue] State machine: ${suggestionState}, trajectory: ${urlTrajectory.length} entries`);

    const response = await fetch(`${API_BASE}/suggest_tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context_blob: contextBlob,
        page_title: tab?.title || "",
        current_url: tab?.url || "",
        trajectory: urlTrajectory.slice(), // Include raw trajectory for backend
      }),
    });

    const data = await response.json();

    if (data.success && data.tasks && data.tasks.length > 0) {
      // Limit to MAX_SUGGESTIONS_PER_BATCH (5 tasks)
      const limitedTasks = data.tasks.slice(0, MAX_SUGGESTIONS_PER_BATCH);
      console.log(`[cue] Auto-suggest returned ${limitedTasks.length} tasks (capped from ${data.tasks.length}):`, limitedTasks.map((t: any) => t.title));

      // Track session task count and active task count
      sessionTaskCount += limitedTasks.length;
      activeTaskCount = Math.min(MAX_ACTIVE_TASKS, activeTaskCount + limitedTasks.length);
      console.log(`[cue] Session task count: ${sessionTaskCount}/${MAX_SESSION_TASKS}, active: ${activeTaskCount}/${MAX_ACTIVE_TASKS}`);

      // Store suggested topic keywords for lockout comparison
      lastSuggestedTopicKeywords = extractTrajectoryKeywords();

      // Send to content script to show notification
      if (tab?.id) {
        console.log(`[cue] Sending PREDICTED_TASKS_POPUP to tab ${tab.id}`);
        chrome.tabs.sendMessage(tab.id, {
          type: "PREDICTED_TASKS_POPUP",
          payload: { tasks: limitedTasks, trigger },
        }).then(() => {
          console.log("[cue] PREDICTED_TASKS_POPUP sent successfully");
          // Note: cooldown will start when user views the suggestions
        }).catch((e) => {
          console.error("[cue] Failed to send PREDICTED_TASKS_POPUP:", e);
          // Fallback: try sending to all tabs
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((t) => {
              if (t.id && t.url && !t.url.startsWith("chrome://")) {
                chrome.tabs.sendMessage(t.id, {
                  type: "PREDICTED_TASKS_POPUP",
                  payload: { tasks: limitedTasks, trigger },
                }).catch(() => {});
              }
            });
          });
        });
      } else {
        console.log("[cue] No active tab id to send popup to");
      }
    } else {
      console.log("[cue] Auto-suggest returned no tasks or failed:", data.error || "empty");
    }
  } catch (error) {
    console.error("[cue] Auto-suggest error:", error);
  }
}

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
        // Apply same guards as triggerAutoSuggest to prevent duplicate/excessive calls
        const now = Date.now();
        if (now - lastGlobalSuggestTime < GLOBAL_SUGGEST_COOLDOWN_MS) {
          console.log(`[cue] CONTEXT_SUGGEST: skipped (global cooldown, ${Math.round((GLOBAL_SUGGEST_COOLDOWN_MS - (now - lastGlobalSuggestTime)) / 1000)}s left)`);
          sendResponse({ success: false, error: "Recently suggested. Try again shortly." });
          return;
        }
        if (activeTaskCount >= MAX_ACTIVE_TASKS) {
          console.log("[cue] CONTEXT_SUGGEST: skipped (user has pending tasks)");
          sendResponse({ success: false, error: "You have pending tasks to review first." });
          return;
        }
        if (sessionTaskCount >= MAX_SESSION_TASKS) {
          sendResponse({ success: false, error: "Session task limit reached." });
          return;
        }
        // Mark global cooldown before the API call
        lastGlobalSuggestTime = now;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const ctx = await getCueContext();
        const blob = buildContextBlob(ctx);
        const pageTitle = tab?.title ?? "";
        const currentUrl = tab?.url ?? "";
        if (!blob.trim() && !pageTitle && !currentUrl) {
          sendResponse({ success: false, error: "No context to suggest from" });
          return;
        }
        let contextBlob = blob.trim() || `Currently viewing: ${pageTitle}\n${currentUrl}`;
        const trajectoryContext = getTrajectoryContext();
        if (trajectoryContext) {
          contextBlob = `${contextBlob}\n\n${trajectoryContext}`;
        }
        const res = await fetch(`${API_BASE}/suggest_tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context_blob: contextBlob,
            page_title: pageTitle,
            current_url: currentUrl,
            trajectory: urlTrajectory.slice(),
          }),
        });
        const data = await res.json();
        if (data.success && data.tasks && data.tasks.length > 0) {
          const limitedTasks = data.tasks.slice(0, MAX_SUGGESTIONS_PER_BATCH);
          // Track counts so triggerAutoSuggest won't fire redundantly
          sessionTaskCount += limitedTasks.length;
          activeTaskCount = Math.min(MAX_ACTIVE_TASKS, activeTaskCount + limitedTasks.length);
          console.log(`[cue] CONTEXT_SUGGEST returned ${limitedTasks.length} tasks. Session: ${sessionTaskCount}, active: ${activeTaskCount}`);

          const count = limitedTasks.length;
          const summary = count === 1
            ? (limitedTasks[0].title || "1 task")
            : `${count} tasks`;
          sendResponse({
            success: true,
            suggestion: `${summary} added to AI Task Automation. View in dashboard.`,
            tasksCount: count,
            tasks: limitedTasks,
          });
        } else {
          sendResponse({
            success: false,
            error: data.error || "No tasks generated. Try more context.",
          });
        }
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || "Suggest failed" });
      }
    })();
    return true;
  }

  // Auto-suggest: generate suggestions based on today's context (for auto_suggestions.tsx)
  if (message.type === "CONTEXT_AUTO_SUGGEST") {
    (async () => {
      try {
        const ctx = await getCueContext();
        // Filter to today's entries only
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayMs = todayStart.getTime();
        const todaySearches = (ctx.recent_searches || []).filter((s) => s.visitedAt >= todayMs);
        const todayChats: Record<string, any[]> = {};
        for (const [host, msgs] of Object.entries(ctx.recent_ai_chats || {})) {
          const filtered = (msgs || []).filter((m: any) => m.capturedAt >= todayMs);
          if (filtered.length) todayChats[host] = filtered;
        }
        const todayCtx = { ...ctx, recent_searches: todaySearches, recent_ai_chats: todayChats };
        const blob = buildContextBlob(todayCtx, { maxSearches: 50, maxMessagesPerHost: 50 });

        const count = message.payload?.count || 5;
        const goal = message.payload?.goal || "";
        const prompt = `Based on the user's browsing and AI chat activity today, propose ${count} helpful, concrete next-step suggestions the user can take. ${goal ? `Focus on: ${goal}` : ""}\n\nContext:\n${blob}`;

        const response = await fetch(`${API_BASE}/ask_ai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: prompt }),
        });
        const data = await response.json();
        sendResponse({ success: data.success !== false, answer: data.answer || data.error || "No suggestions" });
      } catch (e: any) {
        sendResponse({ success: false, error: e?.message || "Auto-suggest failed" });
      }
    })();
    return true;
  }

  // Execute a suggested task (from auto-suggest popup)
  if (message.type === "EXECUTE_SUGGESTED_TASK") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const userToken = await getFreshToken();

        if (!userToken) {
          sendResponse({ success: false, error: "Please sign in with Google first.", requires_auth: true });
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "TASK_EXECUTED",
              payload: { success: false, error: "Please sign in with Google first." },
            });
          }
          return;
        }

        const { service, action, params, taskId } = message;

        // Handle Gemini, Antigravity, and OpenAI Studio - auto-open with context prompt
        if (service === "gemini_chat" || service === "antigravity" || service === "openai_studio") {
          console.log(`[cue] Auto-opening ${service} with context prompt`);

          // Build context-rich prompt from task params and page context
          const contextParts: string[] = [];

          // Add task description/title as main prompt
          if (params?.prompt) {
            contextParts.push(params.prompt);
          } else if (params?.title) {
            contextParts.push(params.title);
          } else if (params?.description) {
            contextParts.push(params.description);
          } else if (action) {
            contextParts.push(action);
          }

          // Add page context if available
          if (tab?.title && tab?.url) {
            contextParts.push(`\n\nContext: I was browsing "${tab.title}" (${tab.url})`);
          }

          // Add any additional context from params
          if (params?.context) {
            contextParts.push(`\n\nAdditional context: ${params.context}`);
          }

          const fullPrompt = contextParts.join("");

          let url = "";
          let userMessage = "";

          if (service === "gemini_chat") {
            // Open Gemini and copy prompt to clipboard (URL params don't populate the text box)
            url = `https://gemini.google.com/app`;
            userMessage = "Opened Gemini - prompt copied to clipboard, paste with Ctrl+V";
          } else if (service === "antigravity") {
            // Open Antigravity web app and copy prompt to clipboard
            // User can paste into desktop app or use web version
            url = `antigravity://`;
            userMessage = "Prompt copied! Open Antigravity desktop app and paste (Ctrl+V), or use the web version";
          } else if (service === "openai_studio") {
            url = `https://chat.openai.com/`;
            userMessage = "Opened ChatGPT - prompt copied to clipboard, paste with Ctrl+V";
          }

          // Copy prompt to clipboard FIRST (before opening new tab to avoid race condition)
          if (tab?.id) {
            try {
              await chrome.tabs.sendMessage(tab.id, {
                type: "COPY_TO_CLIPBOARD",
                payload: { text: fullPrompt },
              });
              // Wait a moment for clipboard to be ready
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (e) {
              console.warn("[cue] Could not copy to clipboard:", e);
            }
          }

          // THEN open the new tab
          console.log(`[cue] Opening ${service} at: ${url}`);
          chrome.tabs.create({ url });

          // Mark task as completed
          if (taskId) {
            try {
              await fetch(`${API_BASE}/suggested_tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "completed", open_url: url }),
              });
              // Decrement session task count to allow generating more
              sessionTaskCount = Math.max(0, sessionTaskCount - 1);
              console.log(`[cue] Task completed. Session count: ${sessionTaskCount}/${MAX_SESSION_TASKS}`);
            } catch (e) {
              console.error("[cue] Failed to mark task as completed:", e);
            }
          }

          const result = { success: true, message: userMessage, open_url: url, promptCopied: true };
          sendResponse(result);

          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "TASK_EXECUTED",
              payload: { ...result, taskId },
            });
          }
          return;
        }

        // Build a synthetic command string for execute_command
        let command = `${action}`;
        if (service === "gmail" && params) {
          command = `${action} email to ${params.to || ""} subject ${params.subject || ""}`;
        } else if (service === "docs" && params) {
          command = `${action} document titled ${params.title || ""}`;
        } else if (service === "calendar" && params) {
          command = `${action} event ${params.title || params.summary || ""}`;
        } else if (service === "tasks" && params) {
          command = `${action} task ${params.title || ""}`;
        }

        const response = await fetch(`${API_BASE}/execute_command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service,
            command,
            user_token: userToken,
            confirm: true, // Execute directly
            suggested_params: { ...(params || {}), _action: action }, // Pass pre-built params with explicit action
            page_title: tab?.title ?? "",
            current_url: tab?.url ?? "",
          }),
        });
        const data = await response.json();

        // If successful and has open_url, open it in a new tab
        if (data.success && data.open_url) {
          console.log(`[cue] Opening URL from task execution: ${data.open_url}`);
          chrome.tabs.create({ url: data.open_url });
        }

        if (taskId) {
          if (data.success) {
            // Mark task as completed
            try {
              await fetch(`${API_BASE}/suggested_tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "completed", open_url: data.open_url || "" }),
              });
              sessionTaskCount = Math.max(0, sessionTaskCount - 1);
              console.log(`[cue] Task completed. Session count: ${sessionTaskCount}/${MAX_SESSION_TASKS}`);
            } catch (e) {
              console.error("[cue] Failed to mark task as completed:", e);
            }
          } else {
            // Execution failed (API error, quota, etc.) — move task to AI queue (in_progress)
            console.warn(`[cue] Task execution failed: ${data.error}. Moving to AI queue.`);
            try {
              await fetch(`${API_BASE}/suggested_tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "in_progress" }),
              });
            } catch (e) {
              console.error("[cue] Failed to move task to AI queue:", e);
            }
          }
        }

        sendResponse(data);

        if (tab?.id) {
          chrome.tabs.sendMessage(tab.id, {
            type: "TASK_EXECUTED",
            payload: { ...data, taskId },
          });
        }
      } catch (error: any) {
        console.error("[cue] Execute suggested task error:", error);
        const { taskId } = message;

        // Move failed task to AI queue (in_progress) so it shows in dashboard
        if (taskId) {
          try {
            await fetch(`${API_BASE}/suggested_tasks/${taskId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "in_progress" }),
            });
          } catch { /* ignore */ }
        }

        const errorResult = { success: false, error: error.message, taskId };
        sendResponse(errorResult);

        // Notify halo to show error toast with library link
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: "TASK_EXECUTED",
              payload: errorResult,
            });
          }
        } catch { /* tab query failed */ }
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
          const context: Record<string, unknown> = {
            query,
            page_title: tab?.title ?? "",
            current_url: tab?.url ?? "",
            selected_text: message.selectedText ?? "",
            user_display_name: message.userDisplayName ?? "",
            user_email: message.userEmail ?? "",
            context_blob: contextBlob || undefined,
          };
          // Support multi-turn conversation history from voice chat popup
          if (Array.isArray(message.conversationHistory) && message.conversationHistory.length > 0) {
            context.conversation_history = message.conversationHistory;
          }

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

        const body: Record<string, any> = {
            service: message.service,
            command: message.command,
            user_token: userToken,
            confirm: true, // Execute for real
            page_title: tab?.title ?? message.pageTitle ?? "",
            current_url: tab?.url ?? message.currentUrl ?? "",
            selected_text: message.selectedText ?? "",
            user_display_name: message.userDisplayName ?? "",
            user_email: message.userEmail ?? "",
        };
        // Forward pre-parsed params from preview to skip redundant Gemini call
        if (message.suggested_params && typeof message.suggested_params === "object") {
            body.suggested_params = message.suggested_params;
        }
        const response = await fetch(`${API_BASE}/execute_command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

  // User viewed/interacted with suggestions - start cooldown
  if (message.type === "USER_VIEWED_SUGGESTIONS") {
    onUserViewedSuggestions();
    sendResponse({ success: true, state: suggestionState });
    return true;
  }

  // User accepted or dismissed a task - decrement active count
  if (message.type === "TASK_ACTION") {
    const count = message.count || 1;
    if (message.action === "accepted") {
      activeTaskCount = Math.max(0, activeTaskCount - count);
      console.log(`[cue] Task accepted. Active count: ${activeTaskCount}/${MAX_ACTIVE_TASKS}`);
    } else if (message.action === "dismissed") {
      activeTaskCount = Math.max(0, activeTaskCount - count);
      console.log(`[cue] Task dismissed (${count}). Active count: ${activeTaskCount}/${MAX_ACTIVE_TASKS}`);
    }
    // Allow new suggestions on next natural trigger (dwell/topic change)
    // but do NOT bypass cooldowns or trigger immediately to avoid excessive API calls
    if (activeTaskCount === 0) {
      suggestionState = "active";
    }
    sendResponse({ success: true, activeTaskCount });
    return true;
  }

  // Get URL trajectory for debugging/context
  if (message.type === "GET_TRAJECTORY") {
    sendResponse({
      success: true,
      trajectory: urlTrajectory.slice(),
      keywords: extractTrajectoryKeywords(),
      state: suggestionState,
    });
    return true;
  }

  // Get suggestion state machine status
  if (message.type === "GET_SUGGESTION_STATE") {
    const now = Date.now();
    let cooldownRemaining = 0;
    let lockoutRemaining = 0;

    if (suggestionState === "cooldown") {
      cooldownRemaining = Math.max(0, AUTO_SUGGEST_COOLDOWN_MS - (now - lastAutoSuggestTime));
    } else if (suggestionState === "lockout") {
      lockoutRemaining = Math.max(0, LOCKOUT_DURATION_MS - (now - lockoutStartTime));
    }

    sendResponse({
      success: true,
      state: suggestionState,
      lastCategory: lastSuggestCategory,
      lastKeywords: lastSuggestedTopicKeywords.slice(0, 5),
      cooldownRemaining: Math.round(cooldownRemaining / 1000),
      lockoutRemaining: Math.round(lockoutRemaining / 1000),
    });
    return true;
  }
});

// ================== TASK SYNC WEBSOCKET ==================
// Connect to backend WebSocket to sync tasks from AI Task Automation dashboard

let taskSyncSocket: WebSocket | null = null;
let taskSyncReconnectAttempts = 0;
const MAX_TASK_SYNC_RECONNECTS = 5;

function connectTaskSyncWebSocket() {
  if (taskSyncSocket?.readyState === WebSocket.OPEN) return;

  try {
    taskSyncSocket = new WebSocket(`${WS_BASE}/ws/extension`);

    taskSyncSocket.onopen = () => {
      console.log("[cue] Task sync WebSocket connected");
      taskSyncReconnectAttempts = 0;
    };

    taskSyncSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle incoming synced tasks from dashboard
        if (data.type === "SYNCED_TASKS" || data.type === "SUGGESTED_TASKS_UPDATE") {
          const tasks = data.tasks || [];
          // Update active task count from synced tasks (including empty state)
          activeTaskCount = Math.min(
            MAX_ACTIVE_TASKS,
            tasks.filter((t: any) => t.status !== "completed" && t.status !== "dismissed").length,
          );
          if (tasks.length > 0) {
            console.log(`[cue] Received ${tasks.length} synced tasks from dashboard`);

            // Store in chrome.storage
            chrome.storage.local.set({ syncedTasks: tasks.slice(0, 50) });

            // Send to active tab
            chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
              if (tab?.id && tab.url && !tab.url.startsWith("chrome://")) {
                chrome.tabs.sendMessage(tab.id, {
                  type: "PREDICTED_TASKS_POPUP",
                  payload: { tasks: tasks.slice(0, MAX_SUGGESTIONS_PER_BATCH), trigger: "sync" },
                }).catch(() => {});
              }
            });
          }
        }

        // Handle activity updates
        if (data.type === "ACTIVITY_UPDATE") {
          console.log("[cue] Activity update from dashboard");
          // Could trigger a refresh of suggestions if needed
        }
      } catch (e) {
        console.error("[cue] Task sync message parse error:", e);
      }
    };

    taskSyncSocket.onclose = (event) => {
      taskSyncSocket = null;

      // Only log if it was a clean close or first disconnect
      if (event.wasClean) {
        console.log("[cue] Task sync WebSocket closed cleanly");
      } else if (taskSyncReconnectAttempts === 0) {
        console.log("[cue] Task sync: Server not available (is Python server running?)");
      }

      // Reconnect with longer backoff when server is down
      if (taskSyncReconnectAttempts < MAX_TASK_SYNC_RECONNECTS) {
        taskSyncReconnectAttempts++;
        const delay = Math.min(10000 * taskSyncReconnectAttempts, 60000); // Start at 10s, max 60s
        if (taskSyncReconnectAttempts === 1) {
          console.log(`[cue] Will retry connection in ${delay / 1000}s`);
        }
        setTimeout(connectTaskSyncWebSocket, delay);
      } else {
        console.log("[cue] Task sync disabled - start server and reload extension to reconnect");
      }
    };

    taskSyncSocket.onerror = () => {
      // WebSocket error events don't contain useful info - onclose handles logging
    };
  } catch (error) {
    console.error("[cue] Failed to create task sync WebSocket:", error);
  }
}

// Connect on startup
connectTaskSyncWebSocket();

// Reconnect when extension wakes up
chrome.runtime.onStartup.addListener(() => {
  console.log("[cue] Extension startup - connecting task sync");
  connectTaskSyncWebSocket();
});
