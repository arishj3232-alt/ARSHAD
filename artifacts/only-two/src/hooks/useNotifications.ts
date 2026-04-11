import { useCallback, useEffect, useRef } from "react";
import { getToken, onMessage, isSupported } from "firebase/messaging";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, getFirebaseMessaging } from "@/lib/firebase";
import { buildVapidKeyCandidates } from "@/lib/fcmVapid";

const VAPID_KEY_RAW = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

/**
 * FCM web push: foreground via onMessage; background via `public/firebase-messaging-sw.js`.
 * Token is stored on `users/{userId}` for Cloud Functions (`functions/`) to send pushes when the app is closed.
 */
export function useNotifications(enabled: boolean, userId?: string | null) {
  const onMessageUnsubRef = useRef<(() => void) | undefined>(undefined);
  /** Skip duplicate getToken for the same user after first success (e.g. React StrictMode remount). */
  const tokenRegisteredForUserRef = useRef<string | null>(null);

  const notify = useCallback(
    (title: string, body: string) => {
      if (!enabled) return;
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(title, {
            body,
            icon: "/favicon.svg",
            silent: false,
            tag: "onlytwo",
          });
        } catch {
          // ignore
        }
      }
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    if (!("Notification" in window)) return undefined;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {
        console.warn("[notifications] Notification permission request failed or was dismissed.");
      });
    }
    return undefined;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;
    if (!("serviceWorker" in navigator)) return undefined;

    let cancelled = false;

    const registerFcm = async () => {
      const vapidCandidates = buildVapidKeyCandidates(VAPID_KEY_RAW);
      if (vapidCandidates.length === 0) {
        console.error(
          "[FCM] Missing or invalid VITE_FIREBASE_VAPID_KEY — set it from Firebase Console → Cloud Messaging → Web Push certificates (public key), then redeploy."
        );
        return;
      }

      try {
        const supported = await isSupported().catch(() => false);
        if (!supported || cancelled) return;

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          console.warn("[FCM] Permission denied");
          return;
        }

        const swPath = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}firebase-messaging-sw.js`;
        const registration = await navigator.serviceWorker.register(swPath);
        await navigator.serviceWorker.ready;

        if (cancelled) return;

        const messaging = getFirebaseMessaging();
        if (!messaging) {
          console.warn("[notifications] Firebase Messaging not available in this browser.");
          return;
        }

        if (tokenRegisteredForUserRef.current !== userId) {
          let token: string | undefined;
          let lastVapidErr: unknown;
          for (const vapidKey of vapidCandidates) {
            try {
              token = await getToken(messaging, {
                vapidKey,
                serviceWorkerRegistration: registration,
              });
              if (vapidKey !== vapidCandidates[0]) {
                console.warn(
                  "[FCM] Subscribed using an alternate VAPID spelling — update VITE_FIREBASE_VAPID_KEY in Vercel to this working value to avoid ambiguity."
                );
              }
              break;
            } catch (e: unknown) {
              lastVapidErr = e;
              const name =
                e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : "";
              const msg = e instanceof Error ? e.message : String(e);
              if (
                name === "InvalidAccessError" ||
                msg.includes("applicationServerKey") ||
                msg.includes("InvalidAccessError")
              ) {
                continue;
              }
              throw e;
            }
          }
          if (!token) {
            throw lastVapidErr ?? new Error("FCM getToken failed for all VAPID candidates");
          }
          console.log("[FCM] Token registered");

          try {
            await setDoc(
              doc(db, "users", userId),
              { fcmToken: token, fcmTokenUpdatedAt: serverTimestamp() },
              { merge: true }
            );
          } catch (persistErr) {
            console.error("[FCM] Failed to save token to Firestore", persistErr);
          }

          tokenRegisteredForUserRef.current = userId;
        } else {
          console.log("[FCM] Skipping duplicate getToken for this user");
        }

        if (cancelled) return;

        onMessageUnsubRef.current = onMessage(messaging, (payload) => {
          console.log("[FCM FOREGROUND]", payload);
          const { title, body } = payload.notification ?? {};
          if (title && body) notify(title, body);
        });
      } catch (err) {
        console.error("[FCM] setup error", err);
        console.warn("[notifications] Service worker / FCM setup failed:", err);
      }
    };

    void registerFcm();

    return () => {
      cancelled = true;
      onMessageUnsubRef.current?.();
      onMessageUnsubRef.current = undefined;
    };
  }, [enabled, userId, notify]);

  useEffect(() => {
    if (!enabled) {
      tokenRegisteredForUserRef.current = null;
    }
  }, [enabled]);

  return { notify };
}
