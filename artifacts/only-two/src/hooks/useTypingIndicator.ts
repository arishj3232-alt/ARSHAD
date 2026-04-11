import { useState, useEffect, useCallback, useRef } from "react";
import { ref, set, onValue, onDisconnect } from "firebase/database";
import { doc, setDoc, deleteField } from "firebase/firestore";
import { db, rtdb } from "@/lib/firebase";

const TYPING_STALE_MS = 4500;
const TYPING_TICK_MS = 400;

function entryIsActive(v: unknown, now: number): boolean {
  if (v === true) return true;
  if (v && typeof v === "object" && "at" in v) {
    const at = (v as { at?: unknown }).at;
    if (typeof at === "number") return now - at < TYPING_STALE_MS;
  }
  return false;
}

export function useTypingIndicator(roomId: string, userId: string | null) {
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const snapshotRef = useRef<Record<string, unknown> | null>(null);

  const recompute = useCallback(() => {
    const data = snapshotRef.current;
    const now = Date.now();
    if (!data || !userId) {
      setIsOtherTyping(false);
      return;
    }
    const others = Object.entries(data).filter(
      ([uid, val]) => uid !== userId && entryIsActive(val, now)
    );
    setIsOtherTyping(others.length > 0);
  }, [userId]);

  const setTyping = useCallback(
    (typing: boolean) => {
      if (!userId) return;
      try {
        set(ref(rtdb, `typing/${roomId}/${userId}`), typing ? { at: Date.now() } : null).catch(() => {});
      } catch {}
      try {
        const pRef = doc(db, "rooms", roomId, "presence", userId);
        if (typing) {
          void setDoc(pRef, { typing: true, typingAt: Date.now() }, { merge: true });
        } else {
          void setDoc(pRef, { typing: false, typingAt: deleteField() }, { merge: true });
        }
      } catch {
        /* presence doc may not exist yet */
      }
    },
    [roomId, userId]
  );

  useEffect(() => {
    if (!roomId) return undefined;
    try {
      let typingDisconnect: { cancel: () => void } | null = null;
      if (userId) {
        const typingRef = ref(rtdb, `typing/${roomId}/${userId}`);
        const d = onDisconnect(typingRef);
        d.remove().catch(() => {});
        typingDisconnect = d;
      }
      const unsub = onValue(
        ref(rtdb, `typing/${roomId}`),
        (snap) => {
          snapshotRef.current = snap.val() as Record<string, unknown> | null;
          recompute();
        },
        () => {}
      );
      const tick = setInterval(recompute, TYPING_TICK_MS);
      return () => {
        if (userId) {
          set(ref(rtdb, `typing/${roomId}/${userId}`), null).catch(() => {});
        }
        typingDisconnect?.cancel();
        unsub();
        clearInterval(tick);
      };
    } catch {
      return undefined;
    }
  }, [roomId, userId, recompute]);

  return { isOtherTyping, setTyping };
}
