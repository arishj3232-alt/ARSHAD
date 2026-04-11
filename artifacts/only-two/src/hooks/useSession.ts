import { useState, useEffect, useCallback, useRef } from "react";
import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { ref, set, onDisconnect, onValue, get, serverTimestamp, remove, runTransaction, update as rtdbUpdate } from "firebase/database";
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
  | { status: "active"; user: SessionUser; otherId: string | null; roomCode: string };

export type SessionRole = "shelly" | "arshad";

type RoleIdentity = {
  role: SessionRole;
  userName: "Shelly" | "Arshad";
};

function resolveRoleIdentity(role: SessionRole): RoleIdentity {
  if (role === "shelly") {
    return { role: "shelly", userName: "Shelly" };
  }
  if (role === "arshad") {
    return { role: "arshad", userName: "Arshad" };
  }
  throw new Error("Invalid role");
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
async function markOffline(roomCode: string, userId: string): Promise<void> {
  const now = Date.now();
  try {
    await updateDoc(doc(db, "rooms", roomCode, "presence", userId), {
      online: false,
      lastSeenTs: now,
    });
  } catch {}
  try {
    await set(ref(rtdb, `status/${roomCode}/${userId}`), { status: "offline", ts: now });
  } catch {}
}

// ─── useSession ───────────────────────────────────────────────────────────────

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: "idle" });
  const [codeError, setCodeError] = useState("");
  const [isRecoveringSession, setIsRecoveringSession] = useState(true);

  // Stable refs for cleanup — survive re-renders without stale closures
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unloadHandlerRef = useRef<(() => void) | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const statusDisconnectRef = useRef<{ cancel: () => void } | null>(null);
  const roleDisconnectRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  const activeRoleRef = useRef<string | null>(null);
  const activeRoomCodeRef = useRef<string | null>(null);

  const armOnlineLifecycle = useCallback((roomCode: string, userId: string, userName: string, role: SessionRole) => {
    const now = Date.now();
    const roleRef = ref(rtdb, `rooms/${roomCode}/roles/${role}`);

    roleDisconnectRef.current?.cancel().catch(() => {});
    const roleDisconnectHandle = onDisconnect(roleRef);
    roleDisconnectHandle.remove().catch(() => {});
    roleDisconnectRef.current = roleDisconnectHandle;
    activeRoleRef.current = role;

    statusDisconnectRef.current?.cancel();
    const rtdbRef = ref(rtdb, `status/${roomCode}/${userId}`);
    set(rtdbRef, { status: "online", ts: now }).catch(() => {});
    const disconnectHandle = onDisconnect(rtdbRef);
    disconnectHandle.set({ status: "offline", ts: serverTimestamp() }).catch(() => {});
    statusDisconnectRef.current = disconnectHandle;

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      setDoc(doc(db, "rooms", roomCode, "presence", userId), { online: true, lastSeenTs: Date.now() }, { merge: true }).catch(() => {});
      set(rtdbRef, { status: "online", ts: Date.now() }).catch(() => {});
    }, HEARTBEAT_MS);

    if (unloadHandlerRef.current) window.removeEventListener("beforeunload", unloadHandlerRef.current);
    const handleUnload = () => {
      updateDoc(doc(db, "rooms", roomCode, "presence", userId), { online: false, lastSeenTs: Date.now() }).catch(() => {});
      set(rtdbRef, { status: "offline", ts: Date.now() }).catch(() => {});
    };
    unloadHandlerRef.current = handleUnload;
    window.addEventListener("beforeunload", handleUnload);

    activeUserIdRef.current = userId;
    activeRoomCodeRef.current = roomCode;
    setState({
      status: "active",
      user: { id: userId, name: userName, joinedAt: new Date(), online: true, lastSeen: null },
      otherId: null,
      roomCode,
    });
  }, []);

  // Clean up on component unmount (e.g. hot reload, app teardown)
  useEffect(() => {
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (unloadHandlerRef.current) window.removeEventListener("beforeunload", unloadHandlerRef.current);
      statusDisconnectRef.current?.cancel();
      statusDisconnectRef.current = null;
      roleDisconnectRef.current?.cancel().catch(() => {});
      roleDisconnectRef.current = null;
      if (activeUserIdRef.current && activeRoomCodeRef.current) {
        markOffline(activeRoomCodeRef.current, activeUserIdRef.current);
      }
      if (activeRoleRef.current && activeRoomCodeRef.current) {
        remove(ref(rtdb, `rooms/${activeRoomCodeRef.current}/roles/${activeRoleRef.current}`)).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const withTimeout = <T,>(p: Promise<T>, ms: number) =>
        Promise.race<T | "timeout">([
          p,
          new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
        ]);

      const storedUserId = sessionStorage.getItem("onlytwo-user-id");
      const storedRoleRaw = sessionStorage.getItem("onlytwo-role");
      const storedRoom = sessionStorage.getItem("onlytwo-room");
      if (!storedUserId || !storedRoleRaw || !storedRoom) {
        if (!cancelled) setIsRecoveringSession(false);
        return;
      }
      if (storedRoleRaw !== "shelly" && storedRoleRaw !== "arshad") {
        sessionStorage.clear();
        if (!cancelled) setIsRecoveringSession(false);
        return;
      }
      const storedRole = storedRoleRaw as SessionRole;
      try {
        const roleRef = ref(rtdb, `rooms/${storedRoom}/roles/${storedRole}`);
        const snapOrTimeout = await withTimeout(get(roleRef), 3000);
        if (snapOrTimeout === "timeout") {
          sessionStorage.clear();
          if (!cancelled) setIsRecoveringSession(false);
          return;
        }
        const snap = snapOrTimeout;
        const val = snap.val() as { userId?: string; userName?: string } | string | null;
        const ownerId = typeof val === "string" ? val : val?.userId;
        if (ownerId !== storedUserId) {
          sessionStorage.clear();
          if (!cancelled) setIsRecoveringSession(false);
          return;
        }
        const fallbackName = storedRole === "shelly" ? "Shelly" : "Arshad";
        const userName = sessionStorage.getItem("onlytwo-user-name") ?? (typeof val === "object" && val?.userName ? val.userName : fallbackName);
        sessionStorage.setItem("onlytwo-user-name", userName);
        if (!cancelled) {
          armOnlineLifecycle(storedRoom, storedUserId, userName, storedRole);
          setIsRecoveringSession(false);
        }
      } catch {
        sessionStorage.clear();
        if (!cancelled) setIsRecoveringSession(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [armOnlineLifecycle]);

  const joinRoom = useCallback(async ({
    role,
    name,
    roomCode,
  }: {
    role: SessionRole;
    name: string;
    roomCode: string;
  }) => {
    void name;
    const normalizedRoomCode = roomCode.trim();
    const validCode = await getAdminRoomCode();
    if (normalizedRoomCode !== validCode.trim()) {
      setCodeError("Wrong room code. This space is only for two.");
      return;
    }

    setCodeError("");
    setState({ status: "joining" });

    const roleIdentity = resolveRoleIdentity(role);
    const userId = `${normalizedRoomCode}_${roleIdentity.role}`;
    const resolvedName = roleIdentity.userName;
    const selectedRole = roleIdentity.role;
    sessionStorage.setItem("onlytwo-user-id", userId);
    sessionStorage.setItem("onlytwo-user-name", resolvedName);
    sessionStorage.setItem("onlytwo-role", selectedRole);
    sessionStorage.setItem("onlytwo-room", normalizedRoomCode);

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
      const presenceCol = collection(db, "rooms", normalizedRoomCode, "presence");
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

      // Strict role lock: only one active tab per role.
      const rolesRootRef = ref(rtdb, `rooms/${normalizedRoomCode}/roles`);
      const rolesSnap = await get(rolesRootRef);
      const rolesData = (rolesSnap.val() ?? {}) as Record<string, unknown>;
      if (Object.keys(rolesData).length > 2) {
        setCodeError("Room roles are corrupted. Please try again.");
        setState({ status: "blocked" });
        return;
      }
      if (Object.keys(rolesData).length >= 2 && !rolesData[selectedRole]) {
        setCodeError("Room is full (both roles already in use).");
        setState({ status: "blocked" });
        return;
      }

      const roleRef = ref(rtdb, `rooms/${normalizedRoomCode}/roles/${selectedRole}`);
      const txResult = await runTransaction(roleRef, (current) => {
        if (current) return;
        return { userId, userName: resolvedName, at: Date.now() };
      });
      if (!txResult.committed) {
        setCodeError("Role already taken in this room");
        setState({ status: "blocked" });
        return;
      }
      // Write own presence doc (merge to preserve any extra fields)
      await setDoc(
        doc(db, "rooms", normalizedRoomCode, "presence", userId),
        { id: userId, name: resolvedName, online: true, lastSeenTs: now },
        { merge: true }
      );
      armOnlineLifecycle(normalizedRoomCode, userId, resolvedName, selectedRole);
    } catch {
      setState({ status: "idle" });
      setCodeError("Connection failed. Please try again.");
    }
  }, []);

  const leaveRoom = useCallback(async () => {
    const userId = activeUserIdRef.current ?? (state.status === "active" ? state.user.id : sessionStorage.getItem("onlytwo-user-id"));
    const roomCode = activeRoomCodeRef.current ?? (state.status === "active" ? state.roomCode : sessionStorage.getItem("onlytwo-room"));
    const role = activeRoleRef.current ?? sessionStorage.getItem("onlytwo-role");
    if (!userId || !roomCode || !role) {
      sessionStorage.clear();
      setState({ status: "idle" });
      return;
    }

    // Stop heartbeat
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    // Remove unload handler
    if (unloadHandlerRef.current) {
      window.removeEventListener("beforeunload", unloadHandlerRef.current);
      unloadHandlerRef.current = null;
    }

    statusDisconnectRef.current?.cancel();
    statusDisconnectRef.current = null;
    roleDisconnectRef.current?.cancel().catch(() => {});
    roleDisconnectRef.current = null;
    const updates: Record<string, null> = {};
    updates[`rooms/${roomCode}/roles/${role}`] = null;
    updates[`status/${roomCode}/${userId}`] = null;
    updates[`cursors/${roomCode}/${userId}`] = null;
    updates[`typing/${roomCode}/${userId}`] = null;
    updates[`devices/${roomCode}/${userId}`] = null;
    await rtdbUpdate(ref(rtdb), updates).catch(() => {});
    await deleteDoc(doc(db, "rooms", roomCode, "presence", userId)).catch(() => {});

    sessionStorage.clear();
    activeUserIdRef.current = null;
    activeRoomCodeRef.current = null;
    activeRoleRef.current = null;
    setState({ status: "idle" });
  }, [state]);

  return { state, codeError, joinRoom, leaveRoom, isRecoveringSession };
}

// ─── usePresence (with 150ms debounce) ───────────────────────────────────────

export function usePresence(_currentUserId: string | null, roomCode: string | null) {
  const [presence, setPresence] = useState<Record<string, SessionUser>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, SessionUser>>({});

  useEffect(() => {
    if (!roomCode) return undefined;
    try {
      const presenceCol = collection(db, "rooms", roomCode, "presence");

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
    } catch {
      return undefined;
    }
  }, [roomCode]);

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
