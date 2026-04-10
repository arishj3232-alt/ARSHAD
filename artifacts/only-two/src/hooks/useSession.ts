import { useState, useEffect, useCallback, useRef } from "react";
import {
  doc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { ref, set, onDisconnect, onValue, get } from "firebase/database";
import { db, rtdb } from "@/lib/firebase";

const ENV_ROOM_CODE = (import.meta.env.VITE_ROOM_CODE as string) ?? "ArshLovesTanvi";
const MAX_OTHER_USERS = 1;          // block a 3rd user (room is for 2)
const STALE_MS = 5 * 60 * 1000;    // 5 min — used for "last seen" display only
const ACTIVE_MS = 45 * 1000;        // 45 s — used for capacity block (2 heartbeat cycles + buffer)
const HEARTBEAT_MS = 25 * 1000;    // refresh presence every 25 s
const PRESENCE_DEBOUNCE_MS = 150;  // batch rapid Firestore updates
const JOIN_DELAY_MS = 400;          // settle delay before capacity check to prevent race conditions on reconnect

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

/** Soft disconnect — keeps doc alive so the other user sees "last seen" */
async function markOffline(userId: string): Promise<void> {
  const now = Date.now();
  try {
    await updateDoc(doc(db, "rooms", "main", "presence", userId), {
      online: false,
      lastSeenTs: now,
    });
  } catch {}
  try {
    await set(ref(rtdb, `status/${userId}`), { status: "offline", ts: now });
  } catch {}
}

// ─── useSession ───────────────────────────────────────────────────────────────

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: "idle" });
  const [codeError, setCodeError] = useState("");

  // Stable refs for cleanup — survive re-renders without stale closures
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unloadHandlerRef = useRef<(() => void) | null>(null);
  const activeUserIdRef = useRef<string | null>(null);

  // Clean up on component unmount (e.g. hot reload, app teardown)
  useEffect(() => {
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (unloadHandlerRef.current) window.removeEventListener("beforeunload", unloadHandlerRef.current);
      if (activeUserIdRef.current) markOffline(activeUserIdRef.current);
    };
  }, []);

  const joinRoom = useCallback(async (code: string, name: string) => {
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
      // Small settle delay: let any in-progress reconnect / onDisconnect handlers
      // finish writing their presence docs before we snapshot the room.
      await new Promise<void>((resolve) => setTimeout(resolve, JOIN_DELAY_MS));

      // Block check — count only truly active other users.
      //
      // Rules:
      //   • d.id === userId  → always skip (same user rejoining)
      //   • online !== true  → skip (already marked offline)
      //   • lastSeenTs age > ACTIVE_MS (45 s) → skip (stale / abandoned session)
      //
      // ACTIVE_MS = 45 s covers 1 missed heartbeat (25 s) plus generous network
      // latency, so a briefly-reconnecting user is never counted twice.
      const presenceCol = collection(db, "rooms", "main", "presence");
      const presenceSnap = await getDocs(presenceCol);
      const now = Date.now();

      const activeOtherCount = presenceSnap.docs.filter((d) => {
        if (d.id === userId) return false;          // own doc — always allow rejoin
        const data = d.data();
        const ts: number = data.lastSeenTs ?? 0;
        return (data.online === true) && (now - ts < ACTIVE_MS);
      }).length;

      if (activeOtherCount > MAX_OTHER_USERS) {
        setState({ status: "blocked" });
        return;
      }

      // Write own presence doc (merge to preserve any extra fields)
      await setDoc(
        doc(db, "rooms", "main", "presence", userId),
        { id: userId, name: name.trim(), online: true, lastSeenTs: now },
        { merge: true }
      );

      // RTDB presence + server-side onDisconnect
      const rtdbRef = ref(rtdb, `status/${userId}`);
      await set(rtdbRef, { status: "online", ts: now }).catch(() => {});
      onDisconnect(rtdbRef).set({ status: "offline", ts: Date.now() }).catch(() => {});

      // Clear any stale heartbeat before starting a new one
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        setDoc(doc(db, "rooms", "main", "presence", userId), { online: true, lastSeenTs: Date.now() }, { merge: true }).catch(() => {});
        set(rtdbRef, { status: "online", ts: Date.now() }).catch(() => {});
      }, HEARTBEAT_MS);

      // Best-effort soft-disconnect on hard tab close
      if (unloadHandlerRef.current) window.removeEventListener("beforeunload", unloadHandlerRef.current);
      const handleUnload = () => {
        updateDoc(doc(db, "rooms", "main", "presence", userId), { online: false, lastSeenTs: Date.now() }).catch(() => {});
        set(rtdbRef, { status: "offline", ts: Date.now() }).catch(() => {});
      };
      unloadHandlerRef.current = handleUnload;
      window.addEventListener("beforeunload", handleUnload);

      activeUserIdRef.current = userId;

      setState({
        status: "active",
        user: { id: userId, name: name.trim(), joinedAt: new Date(), online: true, lastSeen: null },
        otherId: null,
      });
    } catch {
      setState({ status: "idle" });
      setCodeError("Connection failed. Please try again.");
    }
  }, []);

  const leaveRoom = useCallback(() => {
    if (state.status !== "active") return;
    const userId = state.user.id;

    // Stop heartbeat
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    // Remove unload handler
    if (unloadHandlerRef.current) {
      window.removeEventListener("beforeunload", unloadHandlerRef.current);
      unloadHandlerRef.current = null;
    }

    // Soft disconnect — update lastSeen, keep doc alive
    markOffline(userId);

    localStorage.removeItem("onlytwo-user-id");
    activeUserIdRef.current = null;
    setState({ status: "idle" });
  }, [state]);

  return { state, codeError, joinRoom, leaveRoom };
}

// ─── usePresence (with 150ms debounce) ───────────────────────────────────────

export function usePresence(_currentUserId: string | null) {
  const [presence, setPresence] = useState<Record<string, SessionUser>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, SessionUser>>({});

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
          name: (data.name as string) ?? "Unknown",
          joinedAt: null,
          online: !isStale && (data.online === true),
          lastSeen: ts ? new Date(ts) : null,
        };
      });

      // Debounce: batch rapid Firestore snapshots to prevent UI flicker
      pendingRef.current = users;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => setPresence({ ...pendingRef.current }),
        PRESENCE_DEBOUNCE_MS
      );
    });

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []); // stable — presenceCol path never changes

  return presence;
}

// ─── Network connection status (via RTDB .info/connected) ────────────────────

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true); // optimistic default
  const [wasDisconnected, setWasDisconnected] = useState(false);

  useEffect(() => {
    // Firebase RTDB exposes .info/connected — fires within ~30 s of network drop
    const unsub = onValue(ref(rtdb, ".info/connected"), (snap) => {
      const connected = snap.val() === true;
      setIsConnected(connected);
      if (!connected) setWasDisconnected(true);
    });
    return () => unsub();
  }, []);

  return { isConnected, wasDisconnected };
}

// ─── useTypingIndicator ───────────────────────────────────────────────────────

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
          const others = Object.entries(data).filter(([uid, val]) => uid !== userId && val === true);
          setIsOtherTyping(others.length > 0);
        },
        () => {}
      );
      return () => unsub();
    } catch {}
  }, [roomId, userId]);

  return { isOtherTyping, setTyping };
}
