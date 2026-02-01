type CapturedMessage = { role?: string; text: string };

const SUPPORTED_HOSTS = new Set([
  "chat.openai.com",
  "chatgpt.com",
  "gemini.google.com",
  "claude.ai",
  "www.perplexity.ai",
  "perplexity.ai",
]);

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getHostname(): string {
  try {
    return window.location.hostname.toLowerCase();
  } catch {
    return "";
  }
}

function extractChatGPTMessages(): CapturedMessage[] {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-message-author-role]"));
  const msgs = nodes
    .map((el) => ({
      role: el.getAttribute("data-message-author-role") || "unknown",
      text: normalizeText(el.innerText || ""),
    }))
    .filter((m) => m.text.length > 0);

  return msgs.slice(-50).reverse();
}

function extractGenericChatMessages(): CapturedMessage[] {
  const selector = [
    "main [data-testid*='message']",
    "main article",
    "main div[role='listitem']",
    "main section",
  ].join(",");

  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));

  const raw = nodes
    .map((el) => ({
      role: el.getAttribute("data-message-author-role") || "unknown",
      text: normalizeText(el.innerText || ""),
    }))
    .filter((m) => m.text.length > 0);

  const seen = new Set<string>();
  const unique: CapturedMessage[] = [];
  for (let i = raw.length - 1; i >= 0; i--) {
    const m = raw[i];
    const key = `${m.role}@@${m.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(m);
    if (unique.length >= 50) break;
  }

  return unique;
}

function extractMessagesForHost(hostname: string): CapturedMessage[] {
  if (hostname === "chat.openai.com" || hostname === "chatgpt.com") {
    const msgs = extractChatGPTMessages();
    if (msgs.length) return msgs;
  }

  return extractGenericChatMessages();
}

function computeHash(msgs: CapturedMessage[]): string {
  return msgs
    .slice(0, 50)
    .map((m) => `${m.role}:${m.text}`)
    .join("|")
    .slice(0, 2000);
}

export function initChatCapture(): void {
  const hostname = getHostname();
  if (!SUPPORTED_HOSTS.has(hostname)) return;

  let lastHash = "";
  let scheduled: number | null = null;

  const sendSnapshot = () => {
    scheduled = null;

    const messages = extractMessagesForHost(hostname);
    const hash = computeHash(messages);
    if (!messages.length || hash === lastHash) return;
    lastHash = hash;

    try {
      if (!chrome?.runtime?.id) {
        throw new Error("Extension context invalidated");
      }

      chrome.runtime.sendMessage(
        {
          type: "CONTEXT_SAVE_CHAT_MESSAGES",
          payload: {
            hostname,
            url: window.location.href,
            messages,
          },
        },
        () => {}
      );
    } catch {
      // ignore
    }
  };

  const schedule = () => {
    if (scheduled != null) return;
    scheduled = window.setTimeout(sendSnapshot, 1500);
  };

  window.setTimeout(sendSnapshot, 2500);

  const observer = new MutationObserver(() => schedule());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
