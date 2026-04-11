import { getToken, type Messaging } from "firebase/messaging";
import { buildVapidKeyCandidates } from "./fcmVapid";

const LS_PREFIX = "onlytwo-fcm-token:";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logVapidDebug(candidates: string[]): void {
  const k = candidates[0];
  console.log("[FCM] VAPID key:", k ? `present (${k.length} chars, ${candidates.length} candidate(s))` : "none");
}

function isInvalidVapidError(e: unknown): boolean {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : "";
  const msg = e instanceof Error ? e.message : String(e);
  return name === "InvalidAccessError" || msg.includes("applicationServerKey") || msg.includes("InvalidAccessError");
}

/**
 * Firebase-only token path (no manual PushManager.subscribe).
 * Pass the registration returned from `navigator.serviceWorker.register('.../firebase-messaging-sw.js')`.
 */
export async function getFcmTokenWithFirebase(
  messaging: Messaging,
  registration: ServiceWorkerRegistration,
  userId: string
): Promise<string | null> {
  const envRaw = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

  if (envRaw === undefined || String(envRaw).trim() === "") {
    console.error(
      "[FCM] ENV NOT LOADED FROM VERCEL — VITE_FIREBASE_VAPID_KEY is missing or empty. Add it in Vercel → Project → Settings → Environment Variables (Production), then redeploy."
    );
    return null;
  }

  const candidates = buildVapidKeyCandidates(envRaw);
  if (candidates.length === 0) {
    console.error(
      "[FCM] VITE_FIREBASE_VAPID_KEY is set but invalid (must decode to a valid 65-byte Web Push key). Re-copy from Firebase Console → Cloud Messaging → Web Push certificates."
    );
    return null;
  }

  logVapidDebug(candidates);

  const tryCandidates = async (): Promise<string | null> => {
    let lastErr: unknown;
    for (const vapidKey of candidates) {
      try {
        const token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: registration,
        });
        if (token && vapidKey !== candidates[0]) {
          console.warn(
            "[FCM] Subscribed with an alternate VAPID spelling — update VITE_FIREBASE_VAPID_KEY in Vercel to the working value."
          );
        }
        return token || null;
      } catch (e: unknown) {
        lastErr = e;
        if (isInvalidVapidError(e)) continue;
        throw e;
      }
    }
    if (lastErr) console.error("[FCM] getToken failed for all VAPID candidates:", lastErr);
    return null;
  };

  let token = await tryCandidates();
  if (!token) {
    console.warn("[FCM] Retrying getToken once after delay…");
    await sleep(800);
    token = await tryCandidates();
  }

  if (token) {
    try {
      const key = LS_PREFIX + userId;
      const prev = localStorage.getItem(key);
      if (prev !== token) {
        localStorage.setItem(key, token);
        if (prev) console.log("[FCM] FCM token rotated; updated local cache.");
      }
    } catch {
      /* private mode */
    }
  }

  return token;
}
