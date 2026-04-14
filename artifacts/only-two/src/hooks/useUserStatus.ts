import { useState, useEffect, useCallback, useRef } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { ref, set, onValue, onDisconnect, serverTimestamp } from "firebase/database";
import { db, rtdb } from "@/lib/firebase";
import { getOrCreateTabSessionId } from "@/lib/tabSessionId";

export type UserActivityStatus =
  | "online"
  | "recording"
  | "viewingMedia"
  | "browsing"
  | "offline";

const STATUS_DEBOUNCE_MS = 180;
const STATUS_STALE_MS = 75_000;
const STATUS_HEARTBEAT_MS = 5_000;

export type RecordingKind = "audio" | "video";

function parseStatusTs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const sec = (value as { seconds?: unknown }).seconds;
    const ns = (value as { nanoseconds?: unknown }).nanoseconds;
    if (typeof sec === "number" && Number.isFinite(sec)) {
      return sec * 1000 + (typeof ns === "number" && Number.isFinite(ns) ? ns / 1_000_000 : 0);
    }
  }
  return 0;
}

export function useUserStatus(roomCode: string, userId: string | null) {
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStatusRef = useRef<UserActivityStatus | null>(null);
  const lastRecordingKindRef = useRef<RecordingKind | null | undefined>(undefined);
  const lastWriteAtRef = useRef(0);
  const disconnectRef = useRef<{ cancel: () => void } | null>(null);

  const writeStatus = useCallback(
    (status: UserActivityStatus, recordingKind: RecordingKind | null) => {
      if (!userId || !roomCode) return;
      const sessionId = getOrCreateTabSessionId();
      set(ref(rtdb, `status/${roomCode}/${sessionId}`), {
        status,
        ts: Date.now(),
        recordingKind,
      }).catch(() => {});
      lastStatusRef.current = status;
      lastRecordingKindRef.current = recordingKind;
      lastWriteAtRef.current = Date.now();
    },
    [roomCode, userId]
  );

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
          writeStatus(status, recordingKind);
        } catch {}
      }, STATUS_DEBOUNCE_MS);
    },
    [roomCode, userId, writeStatus]
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

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const st = lastStatusRef.current ?? "online";
      const rk = st === "recording" ? lastRecordingKindRef.current ?? null : null;
      writeStatus(st, rk);
    }, STATUS_HEARTBEAT_MS);

    return () => {
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
      disconnectRef.current?.cancel();
      disconnectRef.current = null;
      try {
        writeStatus("offline", null);
      } catch {
        /* */
      }
    };
  }, [roomCode, userId, setStatus, writeStatus]);

  return { setStatus };
}

export function useOtherUserStatus(roomCode: string, otherId: string | null) {
  const [otherStatus, setOtherStatus] = useState<UserActivityStatus>("offline");
  const [otherRecordingKind, setOtherRecordingKind] = useState<RecordingKind | null>(null);
  const [otherTs, setOtherTs] = useState<number>(0);

  useEffect(() => {
    if (!otherId || !roomCode) return undefined;
    const presenceDoc = doc(db, "rooms", roomCode, "presence", otherId);
    let unsubStatus: (() => void) | null = null;
    const clearStatus = () => {
      unsubStatus?.();
      unsubStatus = null;
    };
    const unsubPresence = onSnapshot(
      presenceDoc,
      (snap) => {
        clearStatus();
        const data = snap.data() as { tabSessionId?: string } | undefined;
        const peerSid = typeof data?.tabSessionId === "string" ? data.tabSessionId.trim() : "";
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
              ts?: unknown;
              recordingKind?: string | null;
            } | null;
            const ts = parseStatusTs(dataInner?.ts);
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
      unsubPresence();
    };
  }, [roomCode, otherId]);

  return { otherStatus, otherRecordingKind, otherTs };
}
