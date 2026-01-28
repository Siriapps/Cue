let isLive = false;

export async function startGoLive(): Promise<void> {
  if (isLive) return;
  isLive = true;
  try {
    if (!chrome?.runtime?.id) {
      throw new Error("Extension context invalidated");
    }
    chrome.runtime.sendMessage({ type: "GO_LIVE_START" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[cue] Failed to start go live:", chrome.runtime.lastError.message);
        isLive = false;
      }
    });
  } catch (error: any) {
    console.error("[cue] Extension context invalidated:", error.message);
    isLive = false;
  }
}

export function stopGoLive(): void {
  if (!isLive) return;
  isLive = false;
  try {
    if (!chrome?.runtime?.id) {
      throw new Error("Extension context invalidated");
    }
    chrome.runtime.sendMessage({ type: "GO_LIVE_STOP" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[cue] Failed to stop go live:", chrome.runtime.lastError.message);
      }
    });
  } catch (error: any) {
    console.error("[cue] Extension context invalidated:", error.message);
  }
}
