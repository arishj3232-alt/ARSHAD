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
 * Firebase `getToken` only (no manual PushManager).
 * Per Firebase docs, `vapidKey` is optional — the SDK uses a default key if omitted.
 * We try env keys first; if the browser rejects them, we fall back to omitting `vapidKey`.
 */
export async function getFcmTokenWithFirebase(
  messaging: Messaging,
  registration: ServiceWorkerRegistration,
  userId: string
): Promise<string | null> {
  const envRaw = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  const envMissing = envRaw === undefined || String(envRaw).trim() === "";

  if (envMissing) {
    console.error(
      "[FCM] ENV NOT LOADED FROM VERCEL — VITE_FIREBASE_VAPID_KEY is missing or empty. Will try Firebase default VAPID; add the key in Vercel for best results."
    );
  }

  let candidates: string[] = [];
  if (!envMissing) {
    candidates = buildVapidKeyCandidates(envRaw);
    if (candidates.length === 0) {
      console.warn(
        "[FCM] VITE_FIREBASE_VAPID_KEY is not a valid Web Push key — will try Firebase default VAPID."
      );
    }
  }

  const tryWithVapidKeys = async (): Promise<string | null> => {
    if (candidates.length === 0) return null;
    logVapidDebug(candidates);
    const run = async (): Promise<string | null> => {
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
    let token = await run();
    if (!token) {
      console.warn("[FCM] Retrying VAPID getToken once after delay…");
      await sleep(800);
      token = await run();
    }
    return token;
  };

  let token = await tryWithVapidKeys();

  if (!token) {
    console.warn("[FCM] Falling back to getToken without vapidKey (Firebase-managed default VAPID).");
    try {
      token =
        (await getToken(messaging, {
          serviceWorkerRegistration: registration,
        })) || null;
      if (token) {
        console.log("[FCM] Token obtained via SDK default VAPID. Prefer setting a correct VITE_FIREBASE_VAPID_KEY from Firebase Console → Cloud Messaging → Web Push certificates.");
      }
    } catch (e: unknown) {
      console.error("[FCM] getToken without vapidKey also failed:", e);
      console.error(
        "[FCM] Fix: Firebase Console → Project settings → Cloud Messaging → Web Push certificates → generate or copy the **public** key into VITE_FIREBASE_VAPID_KEY on Vercel (same project as apiKey/appId), then redeploy."
      );
    }
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
