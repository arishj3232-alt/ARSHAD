import { useState, useEffect, useCallback, useRef } from "react";
import {
  doc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  runTransaction,
  onSnapshot,
} from "firebase/firestore";
import { ref, set, onDisconnect, onValue, serverTimestamp, update } from "firebase/database";
import { db, rtdb } from "@/lib/firebase";
import {
  LS_SESSION_KEY,
  parsePersistedSession,
  writePersistedSession,
  clearPersistedSession,
  bumpPersistedSessionActivity,
} from "@/lib/persistedSession";
import { getOrCreatePersistentUserId } from "@/lib/identity";
import { getRoomRouting } from "@/lib/roomConfig";
import { getOrCreateTabSessionId, TAB_SESSION_STORAGE_KEY } from "@/lib/tabSessionId";
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_ONLINE_MAX_AGE_MS,
  isPresenceLive,
} from "@/hooks/usePresence";

const MAX_OTHER_USERS = 1;
const JOIN_DELAY_MS = 400;

export type SessionUser = {
  id: string;
  name: string;
  joinedAt: Date | null;
  online: boolean;
  lastSeen: Date | null;
  typing?: boolean;
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

function roleSlotRef(roomCode: string, role: SessionRole) {
  return doc(db, "rooms", roomCode, "roleSlots", role);
}

/** Claim or refresh Firestore role slot (source of truth). */
async function claimRoleSlot(
  roomCode: string,
  role: SessionRole,
  holderUserId: string,
  displayName: string
): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const r = roleSlotRef(roomCode, role);
    const snap = await transaction.get(r);
    const d = snap.data() as { holderUserId?: string; heartbeatAt?: number } | undefined;
    const now = Date.now();
    const hb = typeof d?.heartbeatAt === "number" ? d.heartbeatAt : 0;
    const holder = d?.holderUserId;
    const stale = !holder || now - hb > PRESENCE_ONLINE_MAX_AGE_MS;

    if (stale) {
      transaction.set(r, { holderUserId, displayName, heartbeatAt: now, role });
      return;
    }
    if (holder === holderUserId) {
      /* Holder immutable here — only refresh liveness + metadata. */
      transaction.update(r, { heartbeatAt: now, displayName, role });
      return;
    }
    throw new Error("ROLE_OCCUPIED");
  });
}

/** Heartbeat only: never mutates holderUserId (prevents stale-tab theft). */
async function touchRoleSlotHeartbeat(
  roomCode: string,
  role: SessionRole,
  holderUserId: string
): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const r = roleSlotRef(roomCode, role);
    const snap = await transaction.get(r);
    if (!snap.exists) return;
    const d = snap.data() as { holderUserId?: string };
    if (d.holderUserId !== holderUserId) return;
    transaction.update(r, { heartbeatAt: Date.now() });
  });
}

async function releaseRoleSlot(roomCode: string, role: SessionRole): Promise<void> {
  try {
    await deleteDoc(roleSlotRef(roomCode, role));
  } catch {
    /* */
  }
}

/** Tab teardown / background: instant “offline” in UI (not ghost-fresh). Multi-tab recovers via heartbeat. */
async function markOffline(roomCode: string, userId: string): Promise<void> {
  const now = Date.now();
  try {
    await setDoc(
      doc(db, "rooms", roomCode, "presence", userId),
      { online: false, lastSeenTs: 0 },
      { merge: true }
    );
  } catch {}
  try {
    const sid = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TAB_SESSION_STORAGE_KEY) : null;
    if (sid) {
      await set(ref(rtdb, `status/${roomCode}/${sid}`), { status: "offline", ts: now });
    }
  } catch {}
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ status: "idle" });
  const [codeError, setCodeError] = useState("");
  const [isRecoveringSession, setIsRecoveringSession] = useState(true);

  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const statusDisconnectRef = useRef<{ cancel: () => void } | null>(null);
  const activeRoleRef = useRef<string | null>(null);
  const activeRoomCodeRef = useRef<string | null>(null);
  const leaveRoomRef = useRef<(() => Promise<void>) | null>(null);

  const armOnlineLifecycle = useCallback((roomCode: string, userId: string, userName: string, role: SessionRole) => {
    const now = Date.now();
    const tabSid = getOrCreateTabSessionId();

    activeRoleRef.current = role;

    statusDisconnectRef.current?.cancel();
    const rtdbRef = ref(rtdb, `status/${roomCode}/${tabSid}`);
    set(rtdbRef, { status: "online", ts: now }).catch(() => {});
    const disconnectHandle = onDisconnect(rtdbRef);
    disconnectHandle.set({ status: "offline", ts: serverTimestamp() }).catch(() => {});
    statusDisconnectRef.current = disconnectHandle;

    void setDoc(
      doc(db, "rooms", roomCode, "presence", userId),
      {
        id: userId,
        name: userName,
        role,
        online: true,
        lastSeenTs: now,
        tabSessionId: tabSid,
      },
      { merge: true }
    ).catch(() => {});

    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      const ts = Date.now();
      void setDoc(
        doc(db, "rooms", roomCode, "presence", userId),
        { online: true, lastSeenTs: ts, tabSessionId: tabSid },
        { merge: true }
      ).catch(() => {});
      void touchRoleSlotHeartbeat(roomCode, role, userId).catch(() => {});
    }, PRESENCE_HEARTBEAT_MS);

    activeUserIdRef.current = userId;
    activeRoomCodeRef.current = roomCode;
    setState({
      status: "active",
      user: { id: userId, name: userName, joinedAt: new Date(), online: true, lastSeen: null },
      otherId: null,
      roomCode,
    });
    writePersistedSession(roomCode, role, userId);
  }, []);

  useEffect(() => {
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      statusDisconnectRef.current?.cancel();
      statusDisconnectRef.current = null;
      if (activeUserIdRef.current && activeRoomCodeRef.current) {
        void markOffline(activeRoomCodeRef.current, activeUserIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      let storedUserId = sessionStorage.getItem("onlytwo-user-id");
      let storedRoleRaw = sessionStorage.getItem("onlytwo-role");
      let storedRoom = sessionStorage.getItem("onlytwo-room");

      const persisted = parsePersistedSession(localStorage.getItem(LS_SESSION_KEY));
      const identityId = getOrCreatePersistentUserId();
      const { firestoreRoomId: serverFr } = await getRoomRouting();
      if (persisted && persisted.userId !== identityId) {
        clearPersistedSession();
        sessionStorage.clear();
        if (!cancelled) setIsRecoveringSession(false);
        return;
      }
      if (persisted && persisted.firestoreRoomId !== serverFr) {
        clearPersistedSession();
        sessionStorage.clear();
        if (!cancelled) setIsRecoveringSession(false);
        return;
      }
      if (
        !persisted &&
        sessionStorage.getItem("onlytwo-user-id") &&
        !localStorage.getItem(LS_SESSION_KEY)
      ) {
        sessionStorage.clear();
        storedUserId = null;
        storedRoleRaw = null;
        storedRoom = null;
      }
      if (persisted) {
        if (!storedUserId) {
          sessionStorage.setItem("onlytwo-user-id", persisted.userId);
          sessionStorage.setItem("onlytwo-role", persisted.role);
          sessionStorage.setItem("onlytwo-room", serverFr);
          sessionStorage.setItem(
            "onlytwo-user-name",
            persisted.role === "shelly" ? "Shelly" : "Arshad"
          );
          storedUserId = persisted.userId;
          storedRoleRaw = persisted.role;
          storedRoom = serverFr;
        } else if (storedUserId !== persisted.userId || storedRoleRaw !== persisted.role) {
          clearPersistedSession();
          sessionStorage.clear();
          if (!cancelled) setIsRecoveringSession(false);
          return;
        } else if (storedRoom !== serverFr) {
          sessionStorage.setItem("onlytwo-room", serverFr);
          storedRoom = serverFr;
        }
      }

      if (!storedUserId || !storedRoleRaw || !storedRoom) {
        if (!cancelled) setIsRecoveringSession(false);
        return;
      }
      if (storedRoleRaw !== "shelly" && storedRoleRaw !== "arshad") {
        clearPersistedSession();
        sessionStorage.clear();
        if (!cancelled) setIsRecoveringSession(false);
        return;
      }
      const storedRole = storedRoleRaw as SessionRole;
      try {
        await claimRoleSlot(
          serverFr,
          storedRole,
          storedUserId,
          storedRole === "shelly" ? "Shelly" : "Arshad"
        );
        const fallbackName = storedRole === "shelly" ? "Shelly" : "Arshad";
        const userName = sessionStorage.getItem("onlytwo-user-name") ?? fallbackName;
        sessionStorage.setItem("onlytwo-user-name", userName);
        if (!cancelled) {
          armOnlineLifecycle(serverFr, storedUserId, userName, storedRole);
          setIsRecoveringSession(false);
        }
      } catch (e) {
        if (e instanceof Error && e.message === "ROLE_OCCUPIED") {
          clearPersistedSession();
          sessionStorage.clear();
          if (!cancelled) setIsRecoveringSession(false);
          return;
        }
        clearPersistedSession();
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
    const normalizedDoor = roomCode.trim();
    const { doorCode, firestoreRoomId } = await getRoomRouting();
    if (normalizedDoor !== doorCode) {
      setCodeError("Wrong room code. This space is only for two.");
      return;
    }

    setCodeError("");
    setState({ status: "joining" });

    const roleIdentity = resolveRoleIdentity(role);
    const userId = getOrCreatePersistentUserId();
    const resolvedName = roleIdentity.userName;
    const selectedRole = roleIdentity.role;

    sessionStorage.setItem("onlytwo-user-id", userId);
    sessionStorage.setItem("onlytwo-user-name", resolvedName);
    sessionStorage.setItem("onlytwo-role", selectedRole);
    sessionStorage.setItem("onlytwo-room", firestoreRoomId);

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, JOIN_DELAY_MS));

      const presenceCol = collection(db, "rooms", firestoreRoomId, "presence");
      const presenceSnap = await getDocs(presenceCol);
      const now = Date.now();

      const activeOtherCount = presenceSnap.docs.filter((d) => {
        if (d.id === userId) return false;
        return isPresenceLive(d.data() as Record<string, unknown>, now);
      }).length;

      if (activeOtherCount > MAX_OTHER_USERS) {
        clearPersistedSession();
        sessionStorage.clear();
        setState({ status: "blocked" });
        return;
      }

      await claimRoleSlot(firestoreRoomId, selectedRole, userId, resolvedName);

      await setDoc(
        doc(db, "rooms", firestoreRoomId, "presence", userId),
        {
          id: userId,
          name: resolvedName,
          role: selectedRole,
          online: true,
          lastSeenTs: now,
          tabSessionId: getOrCreateTabSessionId(),
        },
        { merge: true }
      );
      armOnlineLifecycle(firestoreRoomId, userId, resolvedName, selectedRole);
    } catch (err) {
      clearPersistedSession();
      sessionStorage.clear();
      if (err instanceof Error && err.message === "ROLE_OCCUPIED") {
        setCodeError("Role already taken in this room");
        setState({ status: "blocked" });
        return;
      }
      setState({ status: "idle" });
      setCodeError("Connection failed. Please try again.");
    }
  }, [armOnlineLifecycle]);

  const leaveRoom = useCallback(async () => {
    const userId = activeUserIdRef.current ?? (state.status === "active" ? state.user.id : sessionStorage.getItem("onlytwo-user-id"));
    const roomCode = activeRoomCodeRef.current ?? (state.status === "active" ? state.roomCode : sessionStorage.getItem("onlytwo-room"));
    const role = activeRoleRef.current ?? sessionStorage.getItem("onlytwo-role");
    const statusSessionId =
      typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TAB_SESSION_STORAGE_KEY) : null;
    if (!userId || !roomCode || !role) {
      clearPersistedSession();
      sessionStorage.clear();
      setState({ status: "idle" });
      return;
    }

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    statusDisconnectRef.current?.cancel();
    statusDisconnectRef.current = null;

    const updates: Record<string, null> = {};
    if (statusSessionId) {
      updates[`status/${roomCode}/${statusSessionId}`] = null;
    }
    updates[`cursors/${roomCode}/${userId}`] = null;
    updates[`typing/${roomCode}/${userId}`] = null;
    updates[`devices/${roomCode}/${userId}`] = null;
    await update(ref(rtdb), updates).catch(() => {});

    await deleteDoc(doc(db, "rooms", roomCode, "presence", userId)).catch(() => {});
    if (role === "shelly" || role === "arshad") {
      await releaseRoleSlot(roomCode, role);
    }

    clearPersistedSession();
    sessionStorage.clear();
    activeUserIdRef.current = null;
    activeRoomCodeRef.current = null;
    activeRoleRef.current = null;
    setState({ status: "idle" });
  }, [state]);

  leaveRoomRef.current = leaveRoom;

  const activeRoomCodeForSlot = state.status === "active" ? state.roomCode : null;
  const activeUserIdForSlot = state.status === "active" ? state.user.id : null;

  /** Firestore truth: if we are not the role slot holder, we must not stay in-session. */
  useEffect(() => {
    if (!activeRoomCodeForSlot || !activeUserIdForSlot) return undefined;
    const roomCode = activeRoomCodeForSlot;
    const userId = activeUserIdForSlot;
    const role = activeRoleRef.current;
    if (role !== "shelly" && role !== "arshad") return undefined;

    const slotDoc = doc(db, "rooms", roomCode, "roleSlots", role);
    const unsub = onSnapshot(
      slotDoc,
      (snap) => {
        if (activeRoomCodeRef.current !== roomCode || activeUserIdRef.current !== userId) return;
        if (activeRoleRef.current !== role) return;
        if (!snap.exists) {
          void leaveRoomRef.current?.();
          return;
        }
        const holder = (snap.data()?.holderUserId as string | undefined) ?? "";
        if (holder !== userId) {
          void leaveRoomRef.current?.();
        }
      },
      () => {
        /* transient errors — do not force-leave; next snapshot may recover */
      }
    );
    return () => unsub();
  }, [activeRoomCodeForSlot, activeUserIdForSlot]);

  useEffect(() => {
    if (state.status !== "active") return undefined;
    const onActivity = () => {
      bumpPersistedSessionActivity();
    };
    window.addEventListener("click", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.removeEventListener("click", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [state.status]);

  return { state, codeError, joinRoom, leaveRoom, isRecoveringSession };
}

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const [wasDisconnected, setWasDisconnected] = useState(false);

  useEffect(() => {
    const unsub = onValue(ref(rtdb, ".info/connected"), (snap) => {
      const connected = snap.val() === true;
      setIsConnected(connected);
      if (!connected) setWasDisconnected(true);
    });
    return () => unsub();
  }, []);

  return { isConnected, wasDisconnected };
}
