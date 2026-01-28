import { Readability } from "@mozilla/readability";

export async function summarizePage(): Promise<void> {
  const cloned = document.cloneNode(true) as Document;
  const reader = new Readability(cloned);
  const article = reader.parse();
  const text =
    article?.textContent?.slice(0, 20000) ||
    document.body?.innerText?.slice(0, 20000) ||
    "";

  chrome.runtime.sendMessage({
    type: "PRISM_SUMMARIZE",
    payload: {
      text,
      source_url: window.location.href,
      title: article?.title || document.title,
    },
  });
}
