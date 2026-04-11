/**
 * Web Push `applicationServerKey` must decode to a 65-byte uncompressed P-256 public key
 * and be a valid curve point. Firebase Console → Project settings → Cloud Messaging → Web Push certificates.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function isLikelyVapidKeyLength(key: string): boolean {
  try {
    return urlBase64ToUint8Array(key).length === 65;
  } catch {
    return false;
  }
}

/**
 * Ordered candidates to pass to `getToken({ vapidKey })`.
 * Includes common typo fixes (e.g. letter `l` instead of digit `1` after leading `B`) — same length, wrong point.
 */
export function buildVapidKeyCandidates(raw: string | undefined): string[] {
  if (raw == null || typeof raw !== "string") return [];
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return [];

  const out: string[] = [s];
  if (s.length > 2 && s[0] === "B") {
    const c = s[1];
    if (c === "l" || c === "L" || c === "I") {
      const alt = `B1${s.slice(2)}`;
      if (alt !== s && !out.includes(alt)) out.push(alt);
    }
    if (c === "O" || c === "o") {
      const alt = `B0${s.slice(2)}`;
      if (!out.includes(alt)) out.push(alt);
    }
  }

  return out.filter(isLikelyVapidKeyLength);
}

/** @deprecated use buildVapidKeyCandidates + try getToken */
export function normalizeVapidKey(raw: string | undefined): string | undefined {
  const c = buildVapidKeyCandidates(raw);
  return c[0];
}
