import { useEffect } from "react";
import { LS_LAST_ACTIVE_KEY } from "@/lib/persistedSession";

const INACTIVE_MS = 30 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

function touchLastActive(): void {
  try {
    localStorage.setItem(LS_LAST_ACTIVE_KEY, String(Date.now()));
  } catch {
    /* */
  }
}

function logoutUser(): void {
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    /* */
  }
  window.location.reload();
}

/**
 * Resets the idle timer on user activity; logs out after 30 minutes of inactivity.
 */
export function useInactivityLogout(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;

    touchLastActive();

    const onActivity = () => {
      touchLastActive();
    };

    window.addEventListener("click", onActivity);
    window.addEventListener("keydown", onActivity);

    const intervalId = window.setInterval(() => {
      try {
        const raw = localStorage.getItem(LS_LAST_ACTIVE_KEY);
        const last = raw ? Number(raw) : NaN;
        if (!Number.isFinite(last) || Date.now() - last > INACTIVE_MS) {
          logoutUser();
        }
      } catch {
        logoutUser();
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      window.removeEventListener("click", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.clearInterval(intervalId);
    };
  }, [enabled]);
}
