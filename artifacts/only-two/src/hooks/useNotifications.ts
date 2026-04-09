import { useCallback, useEffect } from "react";

export function useNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }, [enabled]);

  const notify = useCallback(
    (title: string, body: string) => {
      if (!enabled) return;
      if (!("Notification" in window)) return;
      if (!document.hidden) return;
      if (Notification.permission !== "granted") return;
      try {
        new Notification(title, { body, icon: "/favicon.ico" });
      } catch {
        // Failed silently
      }
    },
    [enabled]
  );

  return { notify };
}
