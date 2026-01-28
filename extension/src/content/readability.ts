import { Readability } from "@mozilla/readability";

export async function summarizePage(): Promise<void> {
  const cloned = document.cloneNode(true) as Document;
  const reader = new Readability(cloned);
  const article = reader.parse();
  const text =
    article?.textContent?.slice(0, 20000) ||
    document.body?.innerText?.slice(0, 20000) ||
    "";

  try {
    if (!chrome?.runtime?.id) {
      throw new Error("Extension context invalidated");
    }
    chrome.runtime.sendMessage({
      type: "PRISM_SUMMARIZE",
      payload: {
        text,
        source_url: window.location.href,
        title: article?.title || document.title,
      },
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("[cue] Failed to summarize page:", chrome.runtime.lastError.message);
      }
    });
  } catch (error: any) {
    console.error("[cue] Extension context invalidated:", error.message);
  }
}
