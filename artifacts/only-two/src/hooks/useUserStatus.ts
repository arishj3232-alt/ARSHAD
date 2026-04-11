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

export type RecordingKind = "audio" | "video";

export function useUserStatus(roomCode: string, userId: string | null) {
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatusRef = useRef<UserActivityStatus | null>(null);
  const lastRecordingKindRef = useRef<RecordingKind | null | undefined>(undefined);
  const lastWriteAtRef = useRef(0);
  const disconnectRef = useRef<{ cancel: () => void } | null>(null);

  const setStatus = useCallback(
    (status: UserActivityStatus, opts?: { recordingKind?: RecordingKind | null }) => {
      if (!userId || !roomCode) return;
      const recordingKind = status === "recording" ? opts?.recordingKind ?? null : null;
      if (
        lastStatusRef.current === status &&
        lastRecordingKindRef.current === recordingKind &&
        Date.now() - lastWriteAtRef.current < 15_000
      ) {
        return;
      }
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = setTimeout(() => {
        try {
          set(ref(rtdb, `status/${roomCode}/${userId}`), {
            status,
            ts: Date.now(),
            recordingKind,
          }).catch(() => {});
          lastStatusRef.current = status;
          lastRecordingKindRef.current = recordingKind;
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
      d.set({ status: "offline", ts: serverTimestamp(), recordingKind: null }).catch(() => {});
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
  const [otherRecordingKind, setOtherRecordingKind] = useState<RecordingKind | null>(null);

  useEffect(() => {
    if (!otherId || !roomCode) return undefined;
    try {
      const unsub = onValue(
        ref(rtdb, `status/${roomCode}/${otherId}`),
        (snap) => {
          const data = snap.val() as {
            status?: UserActivityStatus;
            ts?: number;
            recordingKind?: string | null;
          } | null;
          const ts = typeof data?.ts === "number" ? data.ts : 0;
          const stale = ts > 0 && Date.now() - ts > STATUS_STALE_MS;
          if (stale) {
            setOtherStatus("offline");
            setOtherRecordingKind(null);
            return;
          }
          if (data?.status) setOtherStatus(data.status as UserActivityStatus);
          else setOtherStatus("offline");
          const rk = data?.recordingKind;
          setOtherRecordingKind(rk === "video" || rk === "audio" ? rk : null);
        },
        () => {}
      );
      return () => unsub();
    } catch {
      return undefined;
    }
  }, [roomCode, otherId]);

  return { otherStatus, otherRecordingKind };
}
