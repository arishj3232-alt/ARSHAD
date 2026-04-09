import { useState, useEffect, useCallback } from "react";
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
} from "firebase/firestore";
import { ref, set, onDisconnect, onValue } from "firebase/database";
import { db, rtdb } from "@/lib/firebase";

const ROOM_CODE = (import.meta.env.VITE_ROOM_CODE as string) ?? "ArshLovesTanvi";
const MAX_USERS = 2;

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

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: "idle" });
  const [codeError, setCodeError] = useState("");

  const joinRoom = useCallback(async (code: string, name: string) => {
    // Trim + case-sensitive match
    if (code.trim() !== ROOM_CODE.trim()) {
      setCodeError("Wrong room code. This space is only for two.");
      return;
    }

    setCodeError("");
    setState({ status: "joining" });

    const userId = generateUserId();
    localStorage.setItem("onlytwo-user-name", name.trim());

    try {
      // Read current active presence docs to enforce 2-user limit
      const presenceCol = collection(db, "rooms", "main", "presence");
      const presenceSnap = await getDocs(presenceCol);

      const existingIds = presenceSnap.docs
        .map((d) => d.id)
        .filter((id) => id !== userId);

      if (existingIds.length >= MAX_USERS) {
        setState({ status: "blocked" });
        return;
      }

      // Write this user's presence to Firestore
      const userRef = doc(db, "rooms", "main", "presence", userId);
      await setDoc(userRef, {
        id: userId,
        name: name.trim(),
        online: true,
        lastSeen: serverTimestamp(),
      });

      // RTDB presence — fire-and-forget; if RTDB isn't enabled, don't block entry
      try {
        const rtPresenceRef = ref(rtdb, `presence/${userId}`);
        await set(rtPresenceRef, {
          online: true,
          name: name.trim(),
          lastSeen: Date.now(),
        });
        onDisconnect(rtPresenceRef).update({
          online: false,
          lastSeen: Date.now(),
        });
      } catch {
        // RTDB may not be enabled — presence/typing still works via Firestore
      }

      const sessUser: SessionUser = {
        id: userId,
        name: name.trim(),
        joinedAt: new Date(),
        online: true,
        lastSeen: new Date(),
      };

      setState({
        status: "active",
        user: sessUser,
        otherId: existingIds[0] ?? null,
      });
    } catch (err) {
      console.error("Failed to join room:", err);
      setCodeError("Could not connect. Check your internet and try again.");
      setState({ status: "idle" });
    }
  }, []);

  return {
    state,
    setState,
    codeError,
    setCodeError,
    joinRoom,
  };
}

export function usePresence(userId: string | null) {
  const [users, setUsers] = useState<Record<string, SessionUser>>({});

  useEffect(() => {
    if (!userId) return;

    // Try RTDB first, fall back gracefully
    try {
      const presenceRef = ref(rtdb, "presence");
      const unsub = onValue(
        presenceRef,
        (snapshot) => {
          const data = snapshot.val() ?? {};
          const mapped: Record<string, SessionUser> = {};
          for (const [id, val] of Object.entries(
            data as Record<
              string,
              { name: string; online: boolean; lastSeen: number }
            >
          )) {
            mapped[id] = {
              id,
              name: val.name,
              online: val.online,
              lastSeen: val.lastSeen ? new Date(val.lastSeen) : null,
              joinedAt: null,
            };
          }
          setUsers(mapped);
        },
        (err) => {
          console.warn("RTDB presence unavailable:", err.message);
        }
      );
      return () => unsub();
    } catch {
      // RTDB not available
    }
  }, [userId]);

  return users;
}

export function useTypingIndicator(roomId: string, userId: string | null) {
  const [isOtherTyping, setIsOtherTyping] = useState(false);

  const setTyping = useCallback(
    async (typing: boolean) => {
      if (!userId) return;
      try {
        const r = ref(rtdb, `typing/${roomId}/${userId}`);
        await set(r, typing ? { typing: true, ts: Date.now() } : null);
      } catch {
        // RTDB unavailable
      }
    },
    [roomId, userId]
  );

  useEffect(() => {
    if (!userId) return;
    try {
      const r = ref(rtdb, `typing/${roomId}`);
      const unsub = onValue(
        r,
        (snap) => {
          const data = snap.val() ?? {};
          const others = Object.keys(data).filter((id) => id !== userId);
          setIsOtherTyping(others.length > 0);
        },
        () => {}
      );
      return () => unsub();
    } catch {
      // RTDB unavailable
    }
  }, [roomId, userId]);

  return { isOtherTyping, setTyping };
}
