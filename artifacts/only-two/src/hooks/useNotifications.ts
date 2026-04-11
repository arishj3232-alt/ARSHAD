import { useCallback, useEffect, useRef } from "react";
import { onMessage, isSupported } from "firebase/messaging";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, getFirebaseMessaging } from "@/lib/firebase";
import { getFcmTokenWithFirebase } from "@/lib/fcmInit";
import { getVibrationPreference } from "@/lib/vibrationPreference";

function playForegroundNotificationSound(): void {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  const audio = new Audio("/notification.mp3");
  audio.volume = 1;
  void audio.play().catch(() => {
    console.warn("Audio blocked by browser");
  });
}

/**
 * FCM: Firebase `getToken` only (no manual PushManager). Foreground via `onMessage`; background via `public/firebase-messaging-sw.js` (generated at build).
 */
export function useNotifications(enabled: boolean, userId?: string | null) {
  const onMessageUnsubRef = useRef<(() => void) | undefined>(undefined);
  const tokenRegisteredForUserRef = useRef<string | null>(null);

  const showForegroundNotification = useCallback((title: string, body: string, icon = "/favicon.svg") => {
    if (!enabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, icon, silent: false, tag: "onlytwo-fcm" });
    } catch {
      /* */
    }
  }, [enabled]);

  const notify = useCallback(
    (title: string, body: string) => {
      showForegroundNotification(title, body);
    },
    [showForegroundNotification]
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
      try {
        const supported = await isSupported().catch(() => false);
        if (!supported || cancelled) {
          if (!supported) console.warn("[FCM] Messaging not supported in this browser.");
          return;
        }

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          console.warn("[FCM] Notification permission denied");
          return;
        }

        const swPath = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}firebase-messaging-sw.js`;
        const registration = await navigator.serviceWorker.register(swPath);
        await navigator.serviceWorker.ready;

        if (cancelled) return;

        const messaging = getFirebaseMessaging();
        if (!messaging) {
          console.warn("[FCM] getMessaging() unavailable (check Firebase config / HTTPS).");
          return;
        }

        if (tokenRegisteredForUserRef.current !== userId) {
          const token = await getFcmTokenWithFirebase(messaging, registration, userId);
          if (cancelled) return;

          if (!token) {
            console.error("[FCM] No token — push will not work until VAPID/env and permission are fixed.");
            return;
          }

          console.log("[FCM] Token registered (length:", token.length, ")");

          try {
            await setDoc(
              doc(db, "users", userId),
              {
                fcmToken: token,
                fcmTokenUpdatedAt: serverTimestamp(),
                notificationVibration: getVibrationPreference() === "on",
                notificationVibrationUpdatedAt: serverTimestamp(),
              },
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

        onMessageUnsubRef.current?.();
        onMessageUnsubRef.current = onMessage(messaging, (payload) => {
          console.log("[FCM] Foreground message:", payload);
          const d = payload.data as { title?: string; body?: string; icon?: string } | undefined;
          const pn = payload.notification;
          const rawTitle = (typeof pn?.title === "string" ? pn.title : d?.title ?? "").trim();
          const title = rawTitle || "Notification";
          const body =
            typeof pn?.body === "string"
              ? pn.body
              : typeof d?.body === "string"
                ? d.body
                : "";
          const iconRaw = pn?.image ?? d?.icon;
          const icon =
            typeof iconRaw === "string" && iconRaw.length > 0 ? iconRaw : "/favicon.svg";
          showForegroundNotification(title, body, icon);
          playForegroundNotificationSound();
        });
      } catch (err) {
        console.error("[FCM] setup error:", err);
      }
    };

    void registerFcm();

    return () => {
      cancelled = true;
      onMessageUnsubRef.current?.();
      onMessageUnsubRef.current = undefined;
    };
  }, [enabled, userId, showForegroundNotification]);

  useEffect(() => {
    if (!enabled) {
      tokenRegisteredForUserRef.current = null;
    }
  }, [enabled]);

  return { notify };
}
