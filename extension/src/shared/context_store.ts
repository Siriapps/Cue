export const CONTEXT_STORAGE_KEY = "cue_context_v1";

export type CueRole = "user" | "assistant" | "system" | "unknown";

export interface SearchEntry {
  query: string;
  url: string;
  engine?: string;
  visitedAt: number; // ms since epoch
}

export interface ChatMessage {
  role: CueRole;
  text: string;
  capturedAt: number; // ms since epoch
  url?: string;
}

export interface SiteVisit {
  url: string;
  title: string;
  domain: string;
  visitedAt: number; // ms since epoch
  durationMs: number; // time spent on page
}

export interface CueContext {
  recent_searches: SearchEntry[];
  recent_ai_chats: Record<string, ChatMessage[]>; // hostname -> newest-first
  recent_sites: SiteVisit[]; // pages visited >10s, newest-first
  updatedAt: number;
}

function nowMs(): number {
  return Date.now();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function capNewestFirst<T>(items: T[], max: number): T[] {
  return items.slice(0, max);
}

function safeChromeStorageLocal(): chrome.storage.StorageArea | null {
  try {
    return chrome?.storage?.local || null;
  } catch {
    return null;
  }
}

export async function getCueContext(): Promise<CueContext> {
  const storage = safeChromeStorageLocal();
  if (!storage) {
    return { recent_searches: [], recent_ai_chats: {}, recent_sites: [], updatedAt: nowMs() };
  }

  return new Promise((resolve) => {
    storage.get([CONTEXT_STORAGE_KEY], (result) => {
      const raw = result?.[CONTEXT_STORAGE_KEY];
      if (!raw || typeof raw !== "object") {
        resolve({ recent_searches: [], recent_ai_chats: {}, recent_sites: [], updatedAt: nowMs() });
        return;
      }
      resolve({
        recent_searches: Array.isArray(raw.recent_searches) ? raw.recent_searches : [],
        recent_ai_chats: raw.recent_ai_chats && typeof raw.recent_ai_chats === "object" ? raw.recent_ai_chats : {},
        recent_sites: Array.isArray(raw.recent_sites) ? raw.recent_sites : [],
        updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : nowMs(),
      });
    });
  });
}

export async function setCueContext(ctx: CueContext): Promise<void> {
  const storage = safeChromeStorageLocal();
  if (!storage) return;

  return new Promise((resolve) => {
    storage.set({
      [CONTEXT_STORAGE_KEY]: {
        ...ctx,
        updatedAt: nowMs(),
      },
    }, () => resolve());
  });
}

export async function clearCueContext(): Promise<void> {
  await setCueContext({ recent_searches: [], recent_ai_chats: {}, recent_sites: [], updatedAt: nowMs() });
}

export async function addRecentSearch(entry: SearchEntry, max: number = 50): Promise<CueContext> {
  const ctx = await getCueContext();

  const normalizedQuery = normalizeWhitespace(entry.query);
  if (!normalizedQuery) return ctx;

  const normalized: SearchEntry = {
    ...entry,
    query: normalizedQuery,
    visitedAt: entry.visitedAt || nowMs(),
  };

  const deduped = ctx.recent_searches.filter(
    (s) => !(s.query === normalized.query && s.url === normalized.url)
  );

  const next: CueContext = {
    ...ctx,
    recent_searches: capNewestFirst([normalized, ...deduped], max),
    updatedAt: nowMs(),
  };

  await setCueContext(next);
  return next;
}

export async function setRecentSearches(entries: SearchEntry[], max: number = 50): Promise<CueContext> {
  const ctx = await getCueContext();
  const cleaned = entries
    .map((e) => ({
      query: normalizeWhitespace(e.query || ""),
      url: e.url,
      engine: e.engine,
      visitedAt: e.visitedAt || nowMs(),
    }))
    .filter((e) => !!e.query && !!e.url);

  const seen = new Set<string>();
  const uniqueNewestFirst: SearchEntry[] = [];
  for (const e of cleaned) {
    const k = `${e.query}@@${e.url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueNewestFirst.push(e);
    if (uniqueNewestFirst.length >= max) break;
  }

  const next: CueContext = {
    ...ctx,
    recent_searches: uniqueNewestFirst,
    updatedAt: nowMs(),
  };
  await setCueContext(next);
  return next;
}

export async function mergeChatMessages(
  hostname: string,
  incoming: Array<{ role?: CueRole; text: string; capturedAt?: number; url?: string }>,
  max: number = 50
): Promise<CueContext> {
  const host = (hostname || "").trim().toLowerCase();
  if (!host) return getCueContext();

  const ctx = await getCueContext();
  const existing = Array.isArray(ctx.recent_ai_chats?.[host]) ? ctx.recent_ai_chats[host] : [];

  const cleaned = incoming
    .map((m) => ({
      role: (m.role || "unknown") as CueRole,
      text: normalizeWhitespace(m.text || "").slice(0, 4000),
      capturedAt: m.capturedAt || nowMs(),
      url: m.url,
    }))
    .filter((m) => !!m.text);

  const seen = new Set<string>();
  const combined = [...cleaned, ...existing];
  const unique: ChatMessage[] = [];
  for (const m of combined) {
    const k = `${m.role}@@${m.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(m);
    if (unique.length >= max) break;
  }

  const next: CueContext = {
    ...ctx,
    recent_ai_chats: {
      ...ctx.recent_ai_chats,
      [host]: unique,
    },
    updatedAt: nowMs(),
  };

  await setCueContext(next);
  return next;
}

export async function addRecentSite(
  entry: { url: string; title: string; domain: string; visitedAt?: number; durationMs: number },
  max: number = 30
): Promise<CueContext> {
  const ctx = await getCueContext();

  // Skip if duration less than 10 seconds
  if (entry.durationMs < 10000) return ctx;

  // Skip search engine result pages (already tracked as searches)
  const searchDomains = ["google.com", "bing.com", "duckduckgo.com", "yahoo.com", "ecosia.org"];
  if (searchDomains.some((d) => entry.domain.includes(d))) return ctx;

  const normalized: SiteVisit = {
    url: entry.url,
    title: (entry.title || entry.domain).slice(0, 200),
    domain: entry.domain,
    visitedAt: entry.visitedAt || nowMs(),
    durationMs: entry.durationMs,
  };

  // Dedupe by URL
  const deduped = (ctx.recent_sites || []).filter((s) => s.url !== normalized.url);

  const next: CueContext = {
    ...ctx,
    recent_sites: capNewestFirst([normalized, ...deduped], max),
    updatedAt: nowMs(),
  };

  await setCueContext(next);
  return next;
}

export function buildContextBlob(ctx: CueContext, opts?: { maxSearches?: number; maxMessagesPerHost?: number; maxSites?: number }): string {
  const maxSearches = opts?.maxSearches ?? 10;
  const maxMessagesPerHost = opts?.maxMessagesPerHost ?? 12;
  const maxSites = opts?.maxSites ?? 10;

  const lines: string[] = [];
  lines.push("Recent search queries (newest first):");
  for (const s of (ctx.recent_searches || []).slice(0, maxSearches)) {
    lines.push(`- ${s.query}${s.engine ? ` [${s.engine}]` : ""}`);
  }

  // Add recent sites visited
  if (ctx.recent_sites?.length) {
    lines.push("\nRecent sites visited (>10s dwell time, newest first):");
    for (const site of ctx.recent_sites.slice(0, maxSites)) {
      const duration = Math.round(site.durationMs / 1000);
      lines.push(`- ${site.title || site.domain} (${duration}s)`);
    }
  }

  const hosts = Object.keys(ctx.recent_ai_chats || {}).sort();
  if (hosts.length) {
    lines.push("\nRecent AI chat messages (newest first):");
    for (const host of hosts) {
      const msgs = (ctx.recent_ai_chats[host] || []).slice(0, maxMessagesPerHost);
      if (!msgs.length) continue;
      lines.push(`\nHost: ${host}`);
      for (const m of msgs) {
        const role = m.role || "unknown";
        lines.push(`- ${role}: ${m.text}`);
      }
    }
  }

  return lines.join("\n").trim();
}
