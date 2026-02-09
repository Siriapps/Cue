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

    // Insert at the beginning of the body
    if (document.body) {
      document.body.insertBefore(host, document.body.firstChild);
    } else {
      document.documentElement.appendChild(host);
    }
  }

  const shadow = host.shadowRoot || host.attachShadow({ mode: "open" });
  
  // Inject CSS into Shadow DOM if not already present
  if (!shadow.querySelector("#cue-halo-styles")) {
    const styleEl = document.createElement("style");
    styleEl.id = "cue-halo-styles";
    styleEl.textContent = haloStyles;
    shadow.appendChild(styleEl);
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeUI);
  } else {
    initializeUI();
  }
}

init();
