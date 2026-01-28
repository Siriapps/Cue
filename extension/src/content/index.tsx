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
