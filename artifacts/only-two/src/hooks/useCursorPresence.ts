import { useState, useEffect, useCallback, useRef } from "react";
import { ref, set, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";

export type CursorData = {
  x: number;
  y: number;
  name: string;
  userId: string;
};

export function useCursorPresence(userId: string | null, userName: string) {
  const [otherCursors, setOtherCursors] = useState<CursorData[]>([]);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateCursor = useCallback(
    (e: MouseEvent) => {
      if (!userId) return;
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
      }, 50);
      const xPct = (e.clientX / window.innerWidth) * 100;
      const yPct = (e.clientY / window.innerHeight) * 100;
      const r = ref(rtdb, `cursors/${userId}`);
      set(r, { x: xPct, y: yPct, name: userName, userId });
    },
    [userId, userName]
  );

  useEffect(() => {
    window.addEventListener("mousemove", updateCursor);
    return () => window.removeEventListener("mousemove", updateCursor);
  }, [updateCursor]);

  useEffect(() => {
    if (!userId) return;
    const r = ref(rtdb, "cursors");
    const unsub = onValue(r, (snap) => {
      const data = snap.val() ?? {};
      const cursors: CursorData[] = Object.values(data).filter(
        (c: unknown) => (c as CursorData).userId !== userId
      ) as CursorData[];
      setOtherCursors(cursors);
    });
    return () => unsub();
  }, [userId]);

  return { otherCursors };
}
