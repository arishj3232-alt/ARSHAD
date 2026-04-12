export const LS_SESSION_KEY = "session";
export const LS_LAST_ACTIVE_KEY = "lastActive";

export type PersistedSession = {
  /** Stable Firestore + RTDB scope (messages, presence, role slots) — not the join door. */
  firestoreRoomId: string;
  role: "shelly" | "arshad";
  userId: string;
  lastActive: number;
};

function parseSessionPayload(
  raw: string | null
): Omit<PersistedSession, "lastActive"> & { lastActive?: number } | null {
  if (raw == null || raw === "") return null;
  try {
    const s = JSON.parse(raw) as unknown;
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    const role = o.role;
    const userId = o.userId;
    const fromNew = typeof o.firestoreRoomId === "string" && o.firestoreRoomId.trim();
    const fromLegacy = typeof o.roomCode === "string" && o.roomCode.trim();
    const firestoreRoomId = (fromNew ? o.firestoreRoomId : fromLegacy ? o.roomCode : "") as string;
    const fr = firestoreRoomId.trim();
    if (!fr) return null;
    if (role !== "shelly" && role !== "arshad") return null;
    if (typeof userId !== "string" || userId.length < 8) return null;
    if (userId.includes("_")) return null;
    const lastActive =
      typeof o.lastActive === "number" && o.lastActive > 0 ? o.lastActive : undefined;
    return { firestoreRoomId: fr, role, userId, lastActive };
  } catch {
    return null;
  }
}

/**
 * Validates shape. Session persists until explicit logout (no idle TTL eviction).
 */
export function parsePersistedSession(raw: string | null): PersistedSession | null {
  const base = parseSessionPayload(raw);
  if (!base) return null;
  const lastActive = base.lastActive ?? Date.now();
  return { firestoreRoomId: base.firestoreRoomId, role: base.role, userId: base.userId, lastActive };
}

export function writePersistedSession(
  firestoreRoomId: string,
  role: "shelly" | "arshad",
  userId: string
): void {
  try {
    localStorage.setItem(
      LS_SESSION_KEY,
      JSON.stringify({ firestoreRoomId, role, userId, lastActive: Date.now() })
    );
  } catch {
    /* quota / private mode */
  }
}

export function bumpPersistedSessionActivity(): void {
  try {
    const base = parseSessionPayload(localStorage.getItem(LS_SESSION_KEY));
    if (!base) return;
    const lastActive = Date.now();
    localStorage.setItem(
      LS_SESSION_KEY,
      JSON.stringify({
        firestoreRoomId: base.firestoreRoomId,
        role: base.role,
        userId: base.userId,
        lastActive,
      })
    );
  } catch {
    /* */
  }
}

export function clearPersistedSession(): void {
  try {
    localStorage.removeItem(LS_SESSION_KEY);
    localStorage.removeItem(LS_LAST_ACTIVE_KEY);
  } catch {
    /* */
  }
}
