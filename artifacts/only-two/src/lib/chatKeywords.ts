import type { AdminSettings } from "@/hooks/useAdmin";

type BoolSetter = (next: boolean | ((prev: boolean) => boolean)) => void;

let lastCommandTime = 0;

/** Throttle keyword / command handling to reduce accidental spam bursts. */
export const canRunCommand = (): boolean => {
  const now = Date.now();
  if (now - lastCommandTime < 500) return false;
  lastCommandTime = now;
  return true;
};

/** Collapses all whitespace (incl. newlines) for resilient keyword matching. */
export const normalize = (text = ""): string =>
  text.trim().replace(/\s+/g, "").toLowerCase();

/** Dedupe; every value is normalized (lowercase trimmed). */
export const normalizeList = (list: readonly string[] = []): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of list) {
    const n = normalize(k);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
};

export const matchKeyword = (input: string, keyword: string): boolean =>
  normalize(input) === normalize(keyword);

/**
 * `keywords` must already be normalized (use `normalizeList`). Whole-input match only.
 * Do not use substring / includes on raw messages.
 */
export const matchAny = (input: string, keywords: readonly string[] = []): boolean => {
  const norm = normalize(input);
  if (!norm) return false;
  return keywords.includes(norm);
};

export const offKeywordToken = (keyword: string): string => {
  const k = normalize(keyword);
  return `off${k.slice(0, 2)}`;
};

function offTokensForPrimaries(primaries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of primaries) {
    const nk = normalize(k);
    if (!nk) continue;
    const off = normalize(`off${nk.slice(0, 2)}`);
    if (!seen.has(off)) {
      seen.add(off);
      out.push(off);
    }
  }
  return out;
}

/** Extra built-ins (merged with admin-configured lists, all stored normalized). */
const BUILTIN = {
  revealOn: ["ben10", "reveal", "showdeleted"],
  revealOff: ["offbe"],
  ghostOn: ["ghost"],
  readReceiptOn: ["readon"],
  admin: ["admin"],
} as const;

export type KeywordCommandLists = {
  revealOffList: string[];
  revealOnList: string[];
  ghostOffList: string[];
  ghostOnList: string[];
  readReceiptOffList: string[];
  readReceiptOnList: string[];
  adminList: string[];
};

/** All lists are normalized; OFF lists include dynamic `off**` per configured primary. */
export const resolveKeywordLists = (settings: AdminSettings): KeywordCommandLists => {
  const revealOnList = normalizeList([...BUILTIN.revealOn, ...settings.revealKeywords]);
  const ghostOnList = normalizeList([...BUILTIN.ghostOn, ...settings.ghostKeywords]);
  const readReceiptOnList = normalizeList([...BUILTIN.readReceiptOn, ...settings.readReceiptKeywords]);
  const adminList = normalizeList([...BUILTIN.admin, ...settings.adminKeywords]);

  return {
    revealOnList,
    revealOffList: normalizeList([...BUILTIN.revealOff, ...offTokensForPrimaries(settings.revealKeywords)]),
    ghostOnList,
    ghostOffList: normalizeList(offTokensForPrimaries(settings.ghostKeywords)),
    readReceiptOnList,
    readReceiptOffList: normalizeList(offTokensForPrimaries(settings.readReceiptKeywords)),
    adminList,
  };
};

export type ChatKeywordContext = {
  settings: AdminSettings;
  isAdmin: boolean;
  lists: KeywordCommandLists;
  setRevealMode: BoolSetter;
  setGhostMode: BoolSetter;
  setReadReceipt: (enabled: boolean) => void;
  setShowAdmin: (open: boolean) => void;
};

export type HandleKeywordResult = {
  handled: boolean;
  resetDedupe?: boolean;
};

function matchesAnyConfiguredKeyword(input: string, lists: KeywordCommandLists): boolean {
  const pool = [
    ...lists.revealOffList,
    ...lists.revealOnList,
    ...lists.ghostOffList,
    ...lists.ghostOnList,
    ...lists.readReceiptOffList,
    ...lists.readReceiptOnList,
    ...lists.adminList,
  ];
  return pool.includes(input);
}

export const handleKeyword = (text: string, ctx: ChatKeywordContext): HandleKeywordResult => {
  if (!text || !text.trim()) {
    return { handled: false };
  }

  const input = normalize(text);
  if (!input) {
    return { handled: false };
  }

  if (matchesAnyConfiguredKeyword(input, ctx.lists) && !canRunCommand()) {
    return { handled: false };
  }

  const {
    settings,
    isAdmin,
    lists,
    setRevealMode,
    setGhostMode,
    setReadReceipt,
    setShowAdmin,
  } = ctx;

  if (matchAny(input, lists.revealOffList)) {
    setRevealMode(false);
    return { handled: true, resetDedupe: true };
  }

  if (settings.allowGhostMode && matchAny(input, lists.ghostOffList)) {
    setGhostMode(false);
    return { handled: true, resetDedupe: true };
  }

  if (settings.allowReadReceiptToggle && matchAny(input, lists.readReceiptOffList)) {
    setReadReceipt(false);
    return { handled: true, resetDedupe: true };
  }

  if (matchAny(input, lists.revealOnList)) {
    if (!isAdmin) {
      return { handled: false };
    }
    setRevealMode(true);
    return { handled: true };
  }

  if (settings.allowGhostMode && matchAny(input, lists.ghostOnList)) {
    setGhostMode(true);
    return { handled: true };
  }

  if (settings.allowReadReceiptToggle && matchAny(input, lists.readReceiptOnList)) {
    setReadReceipt(true);
    return { handled: true };
  }

  if (matchAny(input, lists.adminList)) {
    setShowAdmin(true);
    if (isAdmin) {
      console.log("Admin opened");
    }
    return { handled: true };
  }

  return { handled: false };
};
