import { useState, useEffect, useCallback, useRef } from "react";
import { ref, set, onValue, onDisconnect, serverTimestamp } from "firebase/database";
import { rtdb } from "@/lib/firebase";

export type UserActivityStatus =
  | "online"
  | "recording"
  | "viewingMedia"
  | "browsing"
  | "offline";

const STATUS_DEBOUNCE_MS = 180;
const STATUS_STALE_MS = 75_000;

export function useUserStatus(roomCode: string, userId: string | null) {
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusRef = useRef<UserActivityStatus | null>(null);
  const lastWriteAtRef = useRef(0);
  const disconnectRef = useRef<{ cancel: () => void } | null>(null);

  const setStatus = useCallback(
    (status: UserActivityStatus) => {
      if (!userId || !roomCode) return;
      if (lastStatusRef.current === status && Date.now() - lastWriteAtRef.current < 15_000) {
        return;
      }
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = setTimeout(() => {
        try {
          set(ref(rtdb, `status/${roomCode}/${userId}`), { status, ts: Date.now() }).catch(() => {});
          lastStatusRef.current = status;
          lastWriteAtRef.current = Date.now();
        } catch {}
      }, STATUS_DEBOUNCE_MS);
    },
    [roomCode, userId]
  );

  useEffect(() => {
    if (!userId || !roomCode) return undefined;
    const statusRef = ref(rtdb, `status/${roomCode}/${userId}`);
    try {
      disconnectRef.current?.cancel();
      const d = onDisconnect(statusRef);
      d.set({ status: "offline", ts: serverTimestamp() }).catch(() => {});
      disconnectRef.current = d;
    } catch {}
    setStatus("online");
    return () => {
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      disconnectRef.current?.cancel();
      disconnectRef.current = null;
      setStatus("offline");
    };
  }, [roomCode, userId, setStatus]);

  return { setStatus };
}

export function useOtherUserStatus(roomCode: string, otherId: string | null) {
  const [otherStatus, setOtherStatus] = useState<UserActivityStatus>("offline");

  useEffect(() => {
    if (!otherId || !roomCode) return undefined;
    try {
      const unsub = onValue(
        ref(rtdb, `status/${roomCode}/${otherId}`),
        (snap) => {
          const data = snap.val();
          const ts = typeof data?.ts === "number" ? data.ts : 0;
          const stale = ts > 0 && Date.now() - ts > STATUS_STALE_MS;
          if (stale) {
            setOtherStatus("offline");
            return;
          }
          if (data?.status) setOtherStatus(data.status as UserActivityStatus);
          else setOtherStatus("offline");
        },
        () => {}
      );
      return () => unsub();
    } catch {
      return undefined;
    }
  }, [roomCode, otherId]);

  return otherStatus;
}
