import { useCallback, useEffect, useRef } from "react";
import { getToken, onMessage, isSupported } from "firebase/messaging";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, getFirebaseMessaging } from "@/lib/firebase";
import { normalizeVapidKey } from "@/lib/fcmVapid";

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
      console.log("[VAPID KEY RAW]", import.meta.env.VITE_FIREBASE_VAPID_KEY);

      const vapidKey = normalizeVapidKey(VAPID_KEY_RAW);
      if (!vapidKey) {
        console.error("[FCM] Missing VAPID key — set VITE_FIREBASE_VAPID_KEY in project root .env and restart dev server.");
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
          const token = await getToken(messaging, {
            vapidKey,
            serviceWorkerRegistration: registration,
          });
          console.log("[FCM TOKEN]", token);

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
