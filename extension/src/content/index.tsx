import React from "react";
import { createRoot } from "react-dom/client";
import { HaloStrip } from "./halo";
import { LiveCompanion } from "./live_companion";
import { initChatCapture } from "./chat_capture";
import { initAutoSuggestions } from "./auto_suggestions";
import { initVoiceChatPopup } from "./voice_chat_popup";
import { startVoiceActivation } from "./voice_activation";
// Import CSS as a string for Shadow DOM injection
import haloStyles from "./halo.css?inline";

const ROOT_ID = "cue-halo-root";

function ensureRoot(): HTMLElement {
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = ROOT_ID;
    // Floating centered position - no body margin manipulation
    host.style.position = "fixed";
    host.style.top = "12px";
    host.style.left = "50%";
    host.style.transform = "translateX(-50%)";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none"; // Allow clicks to pass through to page

    // Insert at the beginning of the body, or documentElement if body doesn't exist
    try {
      if (document.body) {
        document.body.insertBefore(host, document.body.firstChild);
      } else {
        // If body doesn't exist yet, append to documentElement
        document.documentElement.appendChild(host);
      }
    } catch (error) {
      console.error("[cue] Failed to insert root element:", error);
      // Fallback: try appending to documentElement
      try {
        document.documentElement.appendChild(host);
      } catch (e) {
        console.error("[cue] Complete failure to insert root:", e);
        throw e;
      }
    }
  }

  // Ensure shadow DOM exists
  let shadow: ShadowRoot;
  try {
    shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  } catch (error) {
    console.error("[cue] Failed to create shadow DOM:", error);
    throw error;
  }
  
  // Inject CSS into Shadow DOM if not already present
  if (!shadow.querySelector("#cue-halo-styles")) {
    try {
      const styleEl = document.createElement("style");
      styleEl.id = "cue-halo-styles";
      styleEl.textContent = haloStyles;
      shadow.appendChild(styleEl);
    } catch (error) {
      console.error("[cue] Failed to inject styles:", error);
    }
  }
  
  // Use querySelector instead of getElementById in Shadow DOM
  let container = shadow.querySelector("#cue-halo-container") as HTMLElement;
  if (!container) {
    container = document.createElement("div");
    container.id = "cue-halo-container";
    shadow.appendChild(container);
  }
  return container;
}

// Initialize all UI components
function initializeUI() {
  try {
    // Render HaloStrip and LiveCompanion in Shadow DOM
    const container = ensureRoot();
    const root = createRoot(container);
    root.render(
      <>
        <HaloStrip />
        <LiveCompanion />
      </>
    );

    initChatCapture();
    initAutoSuggestions(haloStyles);
    try {
      fetch("http://127.0.0.1:7242/ingest/d175bd2d-d0e3-45e2-bafc-edc26c33de53", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: "index.tsx:initializeUI", message: "calling initVoiceChatPopup", data: {}, timestamp: Date.now() }),
      }).catch(() => {});
    } catch {}
    initVoiceChatPopup(haloStyles);

    // Start voice activation if enabled in settings
    try {
      if (chrome?.storage?.local) {
        chrome.storage.local.get(["cue_voice_activation_enabled_v1"], (res) => {
          if (res?.cue_voice_activation_enabled_v1) {
            startVoiceActivation().catch(() => { /* ignore */ });
          }
        });
      }
    } catch { /* ignore */ }

    console.log("[cue] UI initialized - notifications in halo strip");
  } catch (error) {
    console.error("[cue] Failed to initialize UI:", error);
  }
}

// Wait for DOM to be ready before initializing
function init() {
  // Skip initialization on chrome-extension:// and chrome:// pages (call_ai)
  if (window.location.protocol === "chrome-extension:" || window.location.protocol === "chrome:") {
    console.log("[cue] Skipping initialization on extension page");
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeUI);
  } else {
    initializeUI();
  }
}

// Initialize immediately
init();

// Also listen for navigation events (for SPAs)
if (typeof window !== "undefined") {
  // Re-initialize on navigation for SPAs
  let lastUrl = window.location.href;
  const checkNavigation = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      console.log("[cue] Page navigation detected, re-initializing...");
      // Small delay to let the page settle
      setTimeout(() => {
        const existingRoot = document.getElementById(ROOT_ID);
        if (!existingRoot) {
          init();
        }
      }, 100);
    }
  };
  
  // Check periodically for SPA navigation
  setInterval(checkNavigation, 1000);
  
  // Also listen to popstate for back/forward navigation
  window.addEventListener("popstate", () => {
    setTimeout(checkNavigation, 100);
  });
}
