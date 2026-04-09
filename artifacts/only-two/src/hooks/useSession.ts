import { useState, useEffect, useCallback } from "react";
import {
  doc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
} from "firebase/firestore";
import { ref, set, onDisconnect, onValue, get } from "firebase/database";
import { db, rtdb } from "@/lib/firebase";

const ENV_ROOM_CODE = (import.meta.env.VITE_ROOM_CODE as string) ?? "ArshLovesTanvi";
const MAX_USERS = 2;
const STALE_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

export type SessionUser = {
  id: string;
  name: string;
  joinedAt: Date | null;
  online: boolean;
  lastSeen: Date | null;
};

export type SessionState =
  | { status: "idle" }
  | { status: "blocked" }
  | { status: "joining" }
  | { status: "active"; user: SessionUser; otherId: string | null };

function generateUserId(): string {
  const existing = localStorage.getItem("onlytwo-user-id");
  if (existing) return existing;
  const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem("onlytwo-user-id", id);
  return id;
}

async function getAdminRoomCode(): Promise<string> {
  try {
    const snap = await get(ref(rtdb, "admin/settings/roomCode"));
    const code = snap.val() as string | null;
    return code?.trim() || ENV_ROOM_CODE;
  } catch {
    return ENV_ROOM_CODE;
  }
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: "idle" });
  const [codeError, setCodeError] = useState("");

  const joinRoom = useCallback(async (code: string, name: string) => {
    // Check against admin-controlled room code (falls back to env var)
    const validCode = await getAdminRoomCode();
    if (code.trim() !== validCode.trim()) {
      setCodeError("Wrong room code. This space is only for two.");
      return;
    }

    setCodeError("");
    setState({ status: "joining" });

    const userId = generateUserId();
    localStorage.setItem("onlytwo-user-name", name.trim());

    try {
      const presenceCol = collection(db, "rooms", "main", "presence");
      const presenceSnap = await getDocs(presenceCol);
      const now = Date.now();

      const activeOtherIds = presenceSnap.docs
        .filter((d) => {
          if (d.id === userId) return false;
          const data = d.data();
          const ts: number = data.lastSeenTs ?? 0;
          return now - ts < STALE_MS;
        })
        .map((d) => d.id);

      if (activeOtherIds.length >= MAX_USERS) {
        setState({ status: "blocked" });
        return;
      }

      const userRef = doc(db, "rooms", "main", "presence", userId);
      await setDoc(userRef, {
        id: userId,
        name: name.trim(),
        online: true,
        lastSeenTs: now,
      });

      const cleanupFirestore = () => {
        deleteDoc(doc(db, "rooms", "main", "presence", userId)).catch(() => {});
      };
      window.addEventListener("beforeunload", cleanupFirestore);

      const heartbeat = setInterval(() => {
        setDoc(doc(db, "rooms", "main", "presence", userId), {
          id: userId,
          name: name.trim(),
          online: true,
          lastSeenTs: Date.now(),
        }).catch(() => {});
      }, HEARTBEAT_MS);

      window.addEventListener("beforeunload", () => clearInterval(heartbeat));

      // RTDB presence with onDisconnect cleanup
      const rtdbRef = ref(rtdb, `status/${userId}`);
      await set(rtdbRef, { status: "online", ts: Date.now() }).catch(() => {});
      onDisconnect(rtdbRef).set({ status: "offline", ts: Date.now() }).catch(() => {});

      setState({
        status: "active",
        user: {
          id: userId,
          name: name.trim(),
          joinedAt: new Date(),
          online: true,
          lastSeen: null,
        },
        otherId: null,
      });
    } catch (err) {
      setState({ status: "idle" });
      setCodeError("Connection failed. Please try again.");
    }
  }, []);

  const leaveRoom = useCallback(() => {
    if (state.status !== "active") return;
    deleteDoc(doc(db, "rooms", "main", "presence", state.user.id)).catch(() => {});
    localStorage.removeItem("onlytwo-user-id");
    setState({ status: "idle" });
  }, [state]);

  return { state, codeError, joinRoom, leaveRoom };
}

export function usePresence(currentUserId: string | null) {
  const [presence, setPresence] = useState<Record<string, SessionUser>>({});

  useEffect(() => {
    const presenceCol = collection(db, "rooms", "main", "presence");
    const unsub = onSnapshot(presenceCol, (snap) => {
      const users: Record<string, SessionUser> = {};
      const now = Date.now();
      snap.docs.forEach((d) => {
        const data = d.data();
        const ts: number = data.lastSeenTs ?? 0;
        const isStale = now - ts > STALE_MS;
        users[d.id] = {
          id: d.id,
          name: data.name as string,
          joinedAt: null,
          online: !isStale && (data.online as boolean),
          lastSeen: ts ? new Date(ts) : null,
        };
      });
      setPresence(users);
    });
    return () => unsub();
  }, []);

  return presence;
}

import { onSnapshot } from "firebase/firestore";

export function useTypingIndicator(roomId: string, userId: string | null) {
  const [isOtherTyping, setIsOtherTyping] = useState(false);

  const setTyping = useCallback(
    (typing: boolean) => {
      if (!userId) return;
      try {
        set(ref(rtdb, `typing/${roomId}/${userId}`), typing ? true : null).catch(() => {});
      } catch {}
    },
    [roomId, userId]
  );

  useEffect(() => {
    if (!roomId) return;
    try {
      const unsub = onValue(
        ref(rtdb, `typing/${roomId}`),
        (snap) => {
          const data = snap.val() as Record<string, boolean> | null;
          if (!data || !userId) { setIsOtherTyping(false); return; }
          const others = Object.entries(data)
            .filter(([uid, val]) => uid !== userId && val === true);
          setIsOtherTyping(others.length > 0);
        },
        () => {}
      );
      return () => unsub();
    } catch {}
  }, [roomId, userId]);

  return { isOtherTyping, setTyping };
}
