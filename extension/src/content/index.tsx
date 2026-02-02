import React from "react";
import { createRoot } from "react-dom/client";
import { HaloStrip } from "./halo";
import { LiveCompanion } from "./live_companion";
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

// Wait for DOM to be ready before initializing
function init() {
  // Skip initialization on chrome-extension:// and chrome:// pages
  if (window.location.protocol === "chrome-extension:" || window.location.protocol === "chrome:") {
    console.log("[cue] Skipping initialization on extension page");
    return;
  }

  // Log Google domain detection for debugging
  const hostname = window.location.hostname;
  if (hostname.includes('google.com') || hostname.includes('youtube.com')) {
    console.log("[cue] Detected Google domain:", hostname, "- Initializing Cue");
  }

  const initialize = () => {
    try {
      console.log("[cue] Initializing Halo Strip on:", window.location.href);
      const container = ensureRoot();
      const root = createRoot(container);
      root.render(
        <>
          <HaloStrip />
          <LiveCompanion />
        </>
      );
      console.log("[cue] Halo Strip initialized successfully");
    } catch (error) {
      console.error("[cue] Failed to initialize Halo Strip:", error);
      // Try to show a fallback indicator if React fails
      try {
        const host = document.getElementById(ROOT_ID);
        if (host && !host.shadowRoot?.querySelector("#cue-halo-container")) {
          console.warn("[cue] React initialization failed, but root element exists");
        }
      } catch (e) {
        console.error("[cue] Complete initialization failure:", e);
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    // DOM is already ready, but wait a tick to ensure everything is settled
    setTimeout(initialize, 0);
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
