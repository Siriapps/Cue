import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const AUTO_SUGGEST_DELAY_KEY = "cue_auto_suggest_delay_ms_v1";
const LAST_SUGGESTIONS_KEY = "cue_last_suggestions_v1";
const AUTO_SUGGEST_ROOT_ID = "cue-auto-suggest-root";
const AUTO_SUGGEST_CONTAINER_ID = "cue-auto-suggest-container";

type SavedSuggestions = {
  generatedAt: number;
  sourceQuery?: string;
  items: string[];
  raw?: string;
};

function parseSearchQueryFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();

    const q =
      u.searchParams.get("q") ||
      u.searchParams.get("query") ||
      u.searchParams.get("p") ||
      u.searchParams.get("text") ||
      u.searchParams.get("search");

    const query = (q || "").trim();
    if (!query) return null;

    const isLikelySearch =
      host.includes("google") ||
      host.includes("bing") ||
      host.includes("duckduckgo") ||
      host.includes("yahoo") ||
      host.includes("brave") ||
      host.includes("perplexity") ||
      u.pathname.includes("/search");

    return isLikelySearch ? query : null;
  } catch {
    return null;
  }
}

export function initAutoSuggestions(haloStyles: string): void {
  try {
    if (!document.body) return;

    let host = document.getElementById(AUTO_SUGGEST_ROOT_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = AUTO_SUGGEST_ROOT_ID;
      // Keep it independent from the Halo Strip host.
      document.body.appendChild(host);
    }

    const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });

    if (!shadow.querySelector("#cue-auto-suggest-styles")) {
      const styleEl = document.createElement("style");
      styleEl.id = "cue-auto-suggest-styles";
      styleEl.textContent = haloStyles;
      shadow.appendChild(styleEl);
    }

    let container = shadow.querySelector(`#${AUTO_SUGGEST_CONTAINER_ID}`) as HTMLElement | null;
    if (!container) {
      container = document.createElement("div");
      container.id = AUTO_SUGGEST_CONTAINER_ID;
      shadow.appendChild(container);
    }

    // Avoid double-mount.
    if ((container as any).__cueAutoSuggestMounted) return;
    (container as any).__cueAutoSuggestMounted = true;

    const root = createRoot(container);
    root.render(<AutoSuggestions />);
  } catch {
    // ignore
  }
}

function getDelayMsFromStorage(): Promise<number> {
  return new Promise((resolve) => {
    try {
      if (!chrome?.storage?.local) return resolve(60_000);
      chrome.storage.local.get([AUTO_SUGGEST_DELAY_KEY], (res) => {
        const v = res?.[AUTO_SUGGEST_DELAY_KEY];
        resolve(typeof v === "number" ? v : 60_000);
      });
    } catch {
      resolve(60_000);
    }
  });
}

function parseNumberedSuggestions(text: string): string[] {
  const lines = (text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];

  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\.?\s*(.*)$/);
    if (m && m[2]) {
      out.push(m[2].trim());
    }
  }

  if (out.length >= 3) return out.slice(0, 5);

  // fallback: split by bullet-like separators
  const bullets = (text || "")
    .split(/\n\s*[-•]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return bullets.slice(0, 5);
}

function saveSuggestions(payload: SavedSuggestions): void {
  try {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set({ [LAST_SUGGESTIONS_KEY]: payload }, () => {
      // ignore
    });
  } catch {
    // ignore
  }
}

function dispatchOpenChat(prompt: string): void {
  try {
    window.dispatchEvent(new CustomEvent("cue:open-chat", { detail: { prompt } }));
  } catch {
    // ignore
  }
}

function sendSuggestionsToNotifications(items: string[], sourceQuery?: string): void {
  try {
    if (!chrome?.runtime?.id || items.length === 0) return;
    // Send to background to save as suggested tasks → notification bell + activity page
    chrome.runtime.sendMessage({
      type: "SAVE_AUTO_SUGGESTIONS",
      payload: {
        items,
        sourceQuery: sourceQuery || "",
      },
    });
  } catch {
    // ignore
  }
}

export function AutoSuggestions(): React.JSX.Element {
  const [delayMs, setDelayMs] = useState(60_000);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [items, setItems] = useState<string[]>([]);

  const hasTriggeredRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const currentSearchQuery = useMemo(() => {
    return parseSearchQueryFromUrl(window.location.href);
  }, []);

  useEffect(() => {
    // Load delay setting
    getDelayMsFromStorage().then(setDelayMs);

    // If suggestions already exist, keep them available (but don't auto-open)
    try {
      if (!chrome?.storage?.local) return;
      chrome.storage.local.get([LAST_SUGGESTIONS_KEY], (res) => {
        const saved = res?.[LAST_SUGGESTIONS_KEY] as SavedSuggestions | undefined;
        if (saved?.items?.length) {
          setItems(saved.items.slice(0, 5));
          setRaw(saved.raw || null);
        }
      });
    } catch {
      // ignore
    }

    // React to changes (if user changes via Context panel)
    try {
      if (!chrome?.storage?.onChanged) return;
      const handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
        if (area !== "local") return;
        if (changes[AUTO_SUGGEST_DELAY_KEY]) {
          const v = changes[AUTO_SUGGEST_DELAY_KEY].newValue;
          if (typeof v === "number") setDelayMs(v);
        }
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    // Only trigger on search pages.
    if (!currentSearchQuery) return;
    if (hasTriggeredRef.current) return;

    // Reset timer when delay changes.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      if (hasTriggeredRef.current) return;
      hasTriggeredRef.current = true;

      setIsLoading(true);
      setRaw(null);
      setItems([]);
      setOpen(true);

      try {
        if (!chrome?.runtime?.id) {
          throw new Error("Extension context invalidated");
        }

        chrome.runtime.sendMessage(
          {
            type: "CONTEXT_AUTO_SUGGEST",
            payload: {
              count: 5,
              goal: `The user searched for: ${currentSearchQuery}. Suggest what to do next.`,
            },
          },
          (response) => {
            setIsLoading(false);
            if (chrome.runtime.lastError) {
              setRaw("Extension context invalidated. Please reload the page.");
              return;
            }
            if (response?.success && response?.answer) {
              const parsed = parseNumberedSuggestions(response.answer);
              setRaw(response.answer);
              setItems(parsed);
              saveSuggestions({
                generatedAt: Date.now(),
                sourceQuery: currentSearchQuery,
                items: parsed,
                raw: response.answer,
              });
            } else {
              const err = response?.error || "Failed to generate suggestions";
              setRaw(err);
              saveSuggestions({
                generatedAt: Date.now(),
                sourceQuery: currentSearchQuery,
                items: [],
                raw: err,
              });
            }
          }
        );
      } catch (e: any) {
        setIsLoading(false);
        setRaw(e?.message || "Failed to generate suggestions");
      }
    }, Math.max(5_000, delayMs));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentSearchQuery, delayMs]);

  if (!open) return <></>;

  return (
    <div className="cue-suggest-container">
      <div className="cue-suggest">
        <div className="cue-suggest-header">
          <div className="cue-suggest-title">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="cue-suggest-icon">
              <circle cx="12" cy="12" r="10" fill="url(#suggestGrad)" />
              <path d="M8 12C8 9.79 9.79 8 12 8C14.21 8 16 9.79 16 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="12" cy="14" r="2" fill="white"/>
              <defs>
                <linearGradient id="suggestGrad" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#6366f1"/>
                  <stop offset="1" stopColor="#8b5cf6"/>
                </linearGradient>
              </defs>
            </svg>
            <span>Suggestions for you</span>
          </div>
          <button className="cue-suggest-close" onClick={() => {
            // Send items to notification bell before closing
            if (items.length > 0) {
              sendSuggestionsToNotifications(items, currentSearchQuery || undefined);
            }
            setOpen(false);
          }} title="Close">
            ×
          </button>
        </div>

        {isLoading && (
          <div className="cue-suggest-loading">
            <span className="thinking-dot"></span>
            <span className="thinking-dot"></span>
            <span className="thinking-dot"></span>
            <span>Generating suggestions...</span>
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <div className="cue-suggest-grid">
            {items.slice(0, 5).map((s, i) => (
              <button
                key={i}
                className="cue-suggest-card"
                onClick={() => {
                  dispatchOpenChat(s);
                  setOpen(false);
                }}
                title="Click to start chat"
              >
                <div className="cue-suggest-card-number">{i + 1}</div>
                <div className="cue-suggest-card-content">
                  <div className="cue-suggest-card-text">{s}</div>
                  <div className="cue-suggest-card-action">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                      <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
                    </svg>
                    <span>Start chat</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {!isLoading && items.length === 0 && raw && (
          <div className="cue-suggest-fallback">{raw}</div>
        )}

        <div className="cue-suggest-footer">
          <div className="cue-suggest-hint">💡 Based on your searches + AI chats</div>
          <div className="cue-suggest-hint-sub">Click any suggestion to continue the conversation</div>
        </div>
      </div>
    </div>
  );
}
