import { useState, useEffect, useCallback, useRef } from "react";
import { ref, set, onValue, onDisconnect, serverTimestamp } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { getOrCreateTabSessionId } from "@/lib/tabSessionId";

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
          const sessionId = getOrCreateTabSessionId();
          set(ref(rtdb, `status/${roomCode}/${sessionId}`), {
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
    const sessionId = getOrCreateTabSessionId();
    const statusRef = ref(rtdb, `status/${roomCode}/${sessionId}`);
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

function peerSessionIdFromRoles(data: Record<string, unknown>, otherId: string): string | null {
  for (const role of ["shelly", "arshad"] as const) {
    const node = data[role];
    if (typeof node === "object" && node !== null) {
      const o = node as { userId?: string; sessionId?: string };
      if (o.userId === otherId && typeof o.sessionId === "string" && o.sessionId.length > 0) {
        return o.sessionId;
      }
    }
  }
  return null;
}

export function useOtherUserStatus(roomCode: string, otherId: string | null) {
  const [otherStatus, setOtherStatus] = useState<UserActivityStatus>("offline");
  const [otherRecordingKind, setOtherRecordingKind] = useState<RecordingKind | null>(null);
  const [otherTs, setOtherTs] = useState<number>(0);

  useEffect(() => {
    if (!otherId || !roomCode) return undefined;
    const rolesRef = ref(rtdb, `rooms/${roomCode}/roles`);
    let unsubStatus: (() => void) | null = null;
    const clearStatus = () => {
      unsubStatus?.();
      unsubStatus = null;
    };
    const unsubRoles = onValue(
      rolesRef,
      (snap) => {
        clearStatus();
        const data = (snap.val() ?? {}) as Record<string, unknown>;
        const peerSid = peerSessionIdFromRoles(data, otherId);
        if (!peerSid) {
          setOtherTs(0);
          setOtherStatus("offline");
          setOtherRecordingKind(null);
          return;
        }
        unsubStatus = onValue(
          ref(rtdb, `status/${roomCode}/${peerSid}`),
          (statusSnap) => {
            const dataInner = statusSnap.val() as {
              status?: UserActivityStatus;
              ts?: number;
              recordingKind?: string | null;
            } | null;
            const ts = typeof dataInner?.ts === "number" ? dataInner.ts : 0;
            setOtherTs(ts);
            const stale = ts > 0 && Date.now() - ts > STATUS_STALE_MS;
            if (stale) {
              setOtherStatus("offline");
              setOtherRecordingKind(null);
              return;
            }
            if (dataInner?.status) setOtherStatus(dataInner.status as UserActivityStatus);
            else setOtherStatus("offline");
            const rk = dataInner?.recordingKind;
            setOtherRecordingKind(rk === "video" || rk === "audio" ? rk : null);
          },
          () => {}
        );
      },
      () => {}
    );
    return () => {
      clearStatus();
      unsubRoles();
    };
  }, [roomCode, otherId]);

  return { otherStatus, otherRecordingKind, otherTs };
}
