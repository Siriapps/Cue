import React from "react";
import { createRoot } from "react-dom/client";
import { HaloStrip } from "./halo";
import { LiveCompanion } from "./live_companion";
// Import CSS as a string for Shadow DOM injection
import haloStyles from "./halo.css?inline";

const ROOT_ID = "cue-halo-root";
const HALO_HEIGHT = 48; // Height of the halo bar in pixels

// Function to update body margin based on collapsed state
function updateBodyMargin(isCollapsed: boolean) {
  if (document.body) {
    if (isCollapsed) {
      document.body.style.marginTop = "0";
    } else {
      document.body.style.marginTop = `${HALO_HEIGHT}px`;
    }
    document.body.style.transition = "margin-top 0.3s ease";
  }
}

// Listen for collapsed state changes from storage
if (chrome.storage?.local) {
  chrome.storage.local.get(["haloCollapsed"], (result) => {
    const isCollapsed = result.haloCollapsed === true;
    updateBodyMargin(isCollapsed);
  });
  
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.haloCollapsed) {
      updateBodyMargin(changes.haloCollapsed.newValue === true);
    }
  });
}

function ensureRoot(): HTMLElement {
  let host = document.getElementById(ROOT_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = ROOT_ID;
    // Fixed position at top, full width
    host.style.position = "fixed";
    host.style.top = "0";
    host.style.left = "0";
    host.style.right = "0";
    host.style.zIndex = "2147483647";
    host.style.height = `${HALO_HEIGHT}px`;
    
    // Insert at the beginning of the body
    if (document.body) {
      document.body.insertBefore(host, document.body.firstChild);
    } else {
      document.documentElement.appendChild(host);
    }
    
    // Initial margin - check if collapsed
    if (chrome.storage?.local) {
      chrome.storage.local.get(["haloCollapsed"], (result) => {
        const isCollapsed = result.haloCollapsed === true;
        updateBodyMargin(isCollapsed);
      });
    } else {
      // Default to expanded
      updateBodyMargin(false);
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

// Wait for DOM to be ready before initializing
function init() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      try {
        const container = ensureRoot();
        const root = createRoot(container);
        root.render(
          <>
            <HaloStrip />
            <LiveCompanion />
          </>
        );
      } catch (error) {
        console.error("[cue] Failed to initialize Halo Strip:", error);
      }
    });
  } else {
    try {
      const container = ensureRoot();
      const root = createRoot(container);
      root.render(
        <>
          <HaloStrip />
          <LiveCompanion />
        </>
      );
    } catch (error) {
      console.error("[cue] Failed to initialize Halo Strip:", error);
    }
  }
}

init();
