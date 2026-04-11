import type { AdminSettings } from "@/hooks/useAdmin";

type BoolSetter = (next: boolean | ((prev: boolean) => boolean)) => void;

export const normalize = (text = ""): string => text.trim().toLowerCase();

export const matchKeyword = (input: string, keyword: string): boolean =>
  normalize(input) === normalize(keyword);

/**
 * Whole-line / whole-token match only (normalized equality).
 * NEVER switch to substring or includes() — that would fire inside sentences.
 */
export const matchAny = (input: string, keywords: readonly string[] = []): boolean => {
  const norm = normalize(input);
  if (!norm) return false;
  return keywords.some((k) => normalize(k) === norm);
};

export const offKeywordToken = (keyword: string): string => {
  const k = normalize(keyword);
  return `off${k.slice(0, 2)}`;
};

/** Static aliases (any casing). Room primaries + dynamic `off**` tokens are merged in `resolveKeywordLists`. */
export const KEYWORDS = {
  revealOn: ["ben10", "reveal", "showdeleted"],
  revealOff: ["offbe"],
  ghostOn: ["ghost"],
  readReceiptOn: ["readon"],
  admin: ["admin"],
} as const;

function mergeTerms(...groups: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const t of group) {
      const n = normalize(t);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(t);
    }
  }
  return out;
}

export const resolveKeywordLists = (settings: AdminSettings): {
  revealOn: string[];
  revealOff: string[];
  ghostOn: string[];
  ghostOff: string[];
  readReceiptOn: string[];
  readReceiptOff: string[];
  admin: string[];
} => ({
  revealOn: mergeTerms(KEYWORDS.revealOn, [settings.revealKeyword]),
  revealOff: mergeTerms(KEYWORDS.revealOff, [offKeywordToken(settings.revealKeyword)]),
  ghostOn: mergeTerms(KEYWORDS.ghostOn, [settings.ghostKeyword]),
  ghostOff: mergeTerms([offKeywordToken(settings.ghostKeyword)]),
  readReceiptOn: mergeTerms(KEYWORDS.readReceiptOn, [settings.readReceiptKeyword]),
  readReceiptOff: mergeTerms([offKeywordToken(settings.readReceiptKeyword)]),
  admin: mergeTerms(KEYWORDS.admin, [settings.adminKeyword]),
});

/** Pre-resolved lists from `resolveKeywordLists(settings)` — `handleKeyword` does not call `resolveKeywordLists` itself. */
export type ChatKeywordContext = {
  settings: AdminSettings;
  isAdmin: boolean;
  revealOffList: string[];
  revealOnList: string[];
  ghostOffList: string[];
  ghostOnList: string[];
  readReceiptOffList: string[];
  readReceiptOnList: string[];
  adminList: string[];
  setRevealMode: BoolSetter;
  setGhostMode: BoolSetter;
  setReadReceipt: (enabled: boolean) => void;
  setShowAdmin: (open: boolean) => void;
};

export type HandleKeywordResult = {
  handled: boolean;
  /** Clear send-path dedupe after OFF so the same ON token can run again. */
  resetDedupe?: boolean;
};

export const handleKeyword = (text: string, ctx: ChatKeywordContext): HandleKeywordResult => {
  if (!text || !text.trim()) {
    return { handled: false };
  }

  const input = normalize(text);
  if (!input) {
    return { handled: false };
  }

  const {
    settings,
    isAdmin,
    setRevealMode,
    setGhostMode,
    setReadReceipt,
    setShowAdmin,
    revealOffList,
    revealOnList,
    ghostOffList,
    ghostOnList,
    readReceiptOffList,
    readReceiptOnList,
    adminList,
  } = ctx;

  if (matchAny(input, revealOffList)) {
    setRevealMode(false);
    return { handled: true, resetDedupe: true };
  }

  if (settings.allowGhostMode && matchAny(input, ghostOffList)) {
    setGhostMode(false);
    return { handled: true, resetDedupe: true };
  }

  if (settings.allowReadReceiptToggle && matchAny(input, readReceiptOffList)) {
    setReadReceipt(false);
    return { handled: true, resetDedupe: true };
  }

  if (matchAny(input, revealOnList)) {
    if (!isAdmin) {
      return { handled: false };
    }
    setRevealMode(true);
    return { handled: true };
  }

  if (settings.allowGhostMode && matchAny(input, ghostOnList)) {
    setGhostMode(true);
    return { handled: true };
  }

  if (settings.allowReadReceiptToggle && matchAny(input, readReceiptOnList)) {
    setReadReceipt(true);
    return { handled: true };
  }

  if (matchAny(input, adminList)) {
    setShowAdmin(true);
    if (isAdmin) {
      console.log("Admin command triggered");
    }
    return { handled: true };
  }

  return { handled: false };
};
