/**
 * Web Push applicationServerKey uses raw bytes; Firebase `getToken` accepts the
 * URL-safe base64 string from the console — we normalize whitespace and padding.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** Trim and strip accidental quotes/newlines from `.env` pastes. */
export function normalizeVapidKey(raw: string | undefined): string | undefined {
  if (raw == null || typeof raw !== "string") return undefined;
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.length > 0 ? s : undefined;
}
