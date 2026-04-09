import { useState, useCallback, useEffect, useRef } from "react";
import { getToken, onMessage } from "firebase/messaging";
import { ref, set, get } from "firebase/database";
import { rtdb, getFirebaseMessaging } from "@/lib/firebase";

export type ToastNotification = {
  id: string;
  title: string;
  body: string;
  type?: "text" | "image" | "video" | "audio" | "call";
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export function useNotifications(enabled: boolean, userId?: string | null) {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const swRegisteredRef = useRef(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((notification: Omit<ToastNotification, "id">) => {
    const id = `toast_${Date.now()}`;
    setToasts((prev) => [...prev.slice(-2), { ...notification, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  // Browser Notification API (tab hidden, browser open)
  const notify = useCallback(
    (title: string, body: string, type?: ToastNotification["type"]) => {
      if (!enabled) return;
      // Foreground: in-app toast
      if (!document.hidden) {
        showToast({ title, body, type });
        return;
      }
      // Background: native notification
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(title, {
            body,
            icon: "/favicon.svg",
            silent: false,
            tag: "onlytwo",
            renotify: true,
          });
        } catch {}
      }
    },
    [enabled, showToast]
  );

  // Request browser notification permission
  useEffect(() => {
    if (!enabled) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [enabled]);

  // Register service worker + FCM
  useEffect(() => {
    if (!enabled || !userId || swRegisteredRef.current) return;
    if (!("serviceWorker" in navigator)) return;
    swRegisteredRef.current = true;

    const registerSW = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

        // Send firebase config to SW
        const { firebaseConfig } = await import("@/lib/firebase");
        const sw = reg.installing || reg.waiting || reg.active;
        sw?.postMessage({ type: "FIREBASE_CONFIG", config: firebaseConfig });

        // Get FCM token
        if (!VAPID_KEY) return;
        const messaging = getFirebaseMessaging();
        if (!messaging) return;

        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: reg,
        });

        if (token && userId) {
          await set(ref(rtdb, `fcmTokens/${userId}`), token).catch(() => {});
        }

        // Listen for foreground FCM messages
        onMessage(messaging, (payload) => {
          const { title, body } = payload.notification ?? {};
          if (title && body) showToast({ title, body });
        });
      } catch {}
    };

    registerSW();
  }, [enabled, userId, showToast]);

  return { notify, toasts, showToast, dismissToast };
}

// Push notification via API server (fire and forget)
export async function sendPushNotification(params: {
  toUserId: string;
  title: string;
  body: string;
}) {
  try {
    const tokenSnap = await get(ref(rtdb, `fcmTokens/${params.toUserId}`));
    const token = tokenSnap.val() as string | null;
    if (!token) return;

    await fetch(`${API_BASE}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, title: params.title, body: params.body }),
    });
  } catch {}
}
