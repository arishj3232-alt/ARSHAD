import { useState, useEffect, useCallback } from "react";
import { ref, set, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";

export type UserActivityStatus =
  | "online"
  | "recording"
  | "viewingMedia"
  | "browsing"
  | "offline";

export function useUserStatus(userId: string | null) {
  const setStatus = useCallback(
    (status: UserActivityStatus) => {
      if (!userId) return;
      try {
        set(ref(rtdb, `status/${userId}`), { status, ts: Date.now() }).catch(() => {});
      } catch {}
    },
    [userId]
  );

  useEffect(() => {
    if (!userId) return;
    setStatus("online");
    return () => {
      setStatus("offline");
    };
  }, [userId, setStatus]);

  return { setStatus };
}

export function useOtherUserStatus(otherId: string | null) {
  const [otherStatus, setOtherStatus] = useState<UserActivityStatus>("offline");

  useEffect(() => {
    if (!otherId) return;
    try {
      const unsub = onValue(
        ref(rtdb, `status/${otherId}`),
        (snap) => {
          const data = snap.val();
          if (data?.status) setOtherStatus(data.status as UserActivityStatus);
          else setOtherStatus("offline");
        },
        () => {}
      );
      return () => unsub();
    } catch {}
  }, [otherId]);

  return otherStatus;
}
