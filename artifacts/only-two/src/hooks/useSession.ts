import { useState, useEffect, useCallback } from "react";
import {
  doc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { ref, set, onDisconnect, onValue } from "firebase/database";
import { db, rtdb } from "@/lib/firebase";

const ROOM_CODE = import.meta.env.VITE_ROOM_CODE as string;
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

function getUserName(userId: string): string {
  const existing = localStorage.getItem("onlytwo-user-name");
  if (existing) return existing;
  const name = userId.includes("user_") ? "Arsh" : "Tanvi";
  localStorage.setItem("onlytwo-user-name", name);
  return name;
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: "idle" });
  const [enteredCode, setEnteredCode] = useState("");
  const [codeError, setCodeError] = useState("");

  const joinRoom = useCallback(async (code: string, name: string) => {
    if (code !== ROOM_CODE) {
      setCodeError("Wrong room code. This space is only for two.");
      return;
    }
    setState({ status: "joining" });

    const userId = generateUserId();
    localStorage.setItem("onlytwo-user-name", name);

    const roomRef = doc(db, "rooms", "main");
    const roomSnap = await getDoc(roomRef);

    const members: Record<string, SessionUser> = roomSnap.exists()
      ? roomSnap.data().members ?? {}
      : {};
    const existingIds = Object.keys(members).filter(
      (id) => id !== userId
    );

    if (existingIds.length >= MAX_USERS) {
      setState({ status: "blocked" });
      return;
    }

    const userRef = doc(db, "rooms", "main", "presence", userId);
    await setDoc(userRef, {
      id: userId,
      name,
      online: true,
      lastSeen: serverTimestamp(),
    });

    const rtPresenceRef = ref(rtdb, `presence/${userId}`);
    await set(rtPresenceRef, { online: true, name, lastSeen: Date.now() });
    onDisconnect(rtPresenceRef).update({
      online: false,
      lastSeen: Date.now(),
    });

    const sessUser: SessionUser = {
      id: userId,
      name,
      joinedAt: new Date(),
      online: true,
      lastSeen: new Date(),
    };

    const otherId = existingIds[0] ?? null;
    setState({ status: "active", user: sessUser, otherId });
  }, []);

  return {
    state,
    setState,
    enteredCode,
    setEnteredCode,
    codeError,
    setCodeError,
    joinRoom,
  };
}

export function usePresence(userId: string | null) {
  const [users, setUsers] = useState<Record<string, SessionUser>>({});

  useEffect(() => {
    if (!userId) return;
    const presenceRef = ref(rtdb, "presence");
    const unsub = onValue(presenceRef, (snapshot) => {
      const data = snapshot.val() ?? {};
      const mapped: Record<string, SessionUser> = {};
      for (const [id, val] of Object.entries(data as Record<string, { name: string; online: boolean; lastSeen: number }>)) {
        mapped[id] = {
          id,
          name: val.name,
          online: val.online,
          lastSeen: val.lastSeen ? new Date(val.lastSeen) : null,
          joinedAt: null,
        };
      }
      setUsers(mapped);
    });
    return () => unsub();
  }, [userId]);

  return users;
}

export function useTypingIndicator(roomId: string, userId: string | null) {
  const [isOtherTyping, setIsOtherTyping] = useState(false);

  const setTyping = useCallback(
    async (typing: boolean) => {
      if (!userId) return;
      const r = ref(rtdb, `typing/${roomId}/${userId}`);
      await set(r, typing ? { typing: true, ts: Date.now() } : null);
    },
    [roomId, userId]
  );

  useEffect(() => {
    if (!userId) return;
    const r = ref(rtdb, `typing/${roomId}`);
    const unsub = onValue(r, (snap) => {
      const data = snap.val() ?? {};
      const others = Object.keys(data).filter((id) => id !== userId);
      setIsOtherTyping(others.length > 0);
    });
    return () => unsub();
  }, [roomId, userId]);

  return { isOtherTyping, setTyping };
}
