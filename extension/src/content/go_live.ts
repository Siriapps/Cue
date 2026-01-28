let isLive = false;

export async function startGoLive(): Promise<void> {
  if (isLive) return;
  isLive = true;
  chrome.runtime.sendMessage({ type: "GO_LIVE_START" });
}

export function stopGoLive(): void {
  if (!isLive) return;
  isLive = false;
  chrome.runtime.sendMessage({ type: "GO_LIVE_STOP" });
}
