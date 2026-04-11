import { useState, useEffect, useCallback, useRef } from "react";
import { ref, set, onValue, onDisconnect } from "firebase/database";
import { rtdb } from "@/lib/firebase";

const CURSOR_THROTTLE_MS = 50;
const MIN_CURSOR_DELTA_PCT = 0.35;
const CURSOR_STALE_MS = 12_000;

export type CursorData = {
  x: number;
  y: number;
  name: string;
  userId: string;
  ts: number;
};

export function useCursorPresence(roomCode: string, userId: string | null, userName: string) {
  const [otherCursors, setOtherCursors] = useState<CursorData[]>([]);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const lastSentRef = useRef<{ x: number; y: number } | null>(null);

  const flushCursor = useCallback(() => {
    rafRef.current = null;
    if (!userId) return;
    const p = pendingRef.current;
    if (!p) return;
    const last = lastSentRef.current;
    if (
      last &&
      Math.abs(last.x - p.x) < MIN_CURSOR_DELTA_PCT &&
      Math.abs(last.y - p.y) < MIN_CURSOR_DELTA_PCT
    ) {
      return;
    }
    const r = ref(rtdb, `cursors/${roomCode}/${userId}`);
    set(r, { x: p.x, y: p.y, name: userName, userId, ts: Date.now() }).catch(() => {});
    lastSentRef.current = p;
  }, [roomCode, userId, userName]);

  const updateCursor = useCallback(
    (e: MouseEvent) => {
      if (!userId) return;
      if (document.hidden) return;
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
      }, CURSOR_THROTTLE_MS);

      const xPct = (e.clientX / window.innerWidth) * 100;
      const yPct = (e.clientY / window.innerHeight) * 100;
      pendingRef.current = { x: xPct, y: yPct };
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flushCursor);
      }
    },
    [userId, flushCursor]
  );

  useEffect(() => {
    if (!userId) return undefined;
    const cursorRef = ref(rtdb, `cursors/${roomCode}/${userId}`);
    const disconnectHandle = onDisconnect(cursorRef);
    disconnectHandle.remove().catch(() => {});

    window.addEventListener("mousemove", updateCursor);
    return () => {
      window.removeEventListener("mousemove", updateCursor);
      if (throttleRef.current) clearTimeout(throttleRef.current);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      disconnectHandle.cancel().catch(() => {});
      set(cursorRef, null).catch(() => {});
    };
  }, [roomCode, updateCursor, userId]);

  useEffect(() => {
    if (!userId) return undefined;
    const r = ref(rtdb, `cursors/${roomCode}`);
    const unsub = onValue(r, (snap) => {
      const data = snap.val() ?? {};
      const now = Date.now();
      const cursors: CursorData[] = Object.values(data).filter(
        (c: unknown) => {
          const cur = c as Partial<CursorData>;
          if (!cur || typeof cur !== "object") return false;
          if (cur.userId === userId) return false;
          if (typeof cur.ts !== "number") return false;
          if (now - cur.ts > CURSOR_STALE_MS) return false;
          return true;
        }
      ) as CursorData[];
      const otherUser = cursors[0];
      setOtherCursors(otherUser ? [otherUser] : []);
    });
    return () => unsub();
  }, [roomCode, userId]);

  return { otherCursors };
}
