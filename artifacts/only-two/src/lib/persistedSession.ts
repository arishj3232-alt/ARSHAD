export const LS_SESSION_KEY = "session";
export const LS_LAST_ACTIVE_KEY = "lastActive";

/** Inactivity TTL — session restore + server-side interval use the same window. */
export const SESSION_TTL_MS = 30 * 60 * 1000;

export type PersistedSession = {
  roomCode: string;
  role: "shelly" | "arshad";
  userId: string;
  lastActive: number;
};

function parseSessionPayload(raw: string | null): Omit<PersistedSession, "lastActive"> & { lastActive?: number } | null {
  if (raw == null || raw === "") return null;
  try {
    const s = JSON.parse(raw) as unknown;
    if (!s || typeof s !== "object") return null;
    const o = s as Record<string, unknown>;
    const roomCode = o.roomCode;
    const role = o.role;
    const userId = o.userId;
    if (typeof roomCode !== "string" || !roomCode.trim()) return null;
    const rc = roomCode.trim();
    if (role !== "shelly" && role !== "arshad") return null;
    if (typeof userId !== "string" || !userId.length) return null;
    if (userId !== `${rc}_${role}`) return null;
    const lastActive =
      typeof o.lastActive === "number" && o.lastActive > 0 ? o.lastActive : undefined;
    return { roomCode: rc, role, userId, lastActive };
  } catch {
    return null;
  }
}

/**
 * Validates shape + TTL. Clears expired entries from localStorage.
 * Legacy payloads without `lastActive` are treated as fresh (migration).
 */
export function parsePersistedSession(raw: string | null): PersistedSession | null {
  const base = parseSessionPayload(raw);
  if (!base) return null;
  const lastActive = base.lastActive ?? Date.now();
  if (Date.now() - lastActive > SESSION_TTL_MS) {
    try {
      localStorage.removeItem(LS_SESSION_KEY);
    } catch {
      /* */
    }
    return null;
  }
  return { roomCode: base.roomCode, role: base.role, userId: base.userId, lastActive };
}

export function writePersistedSession(roomCode: string, role: "shelly" | "arshad", userId: string): void {
  try {
    localStorage.setItem(
      LS_SESSION_KEY,
      JSON.stringify({ roomCode, role, userId, lastActive: Date.now() })
    );
  } catch {
    /* quota / private mode */
  }
}

/** Bump `lastActive` without TTL check — for user activity listeners while already in-session. */
export function bumpPersistedSessionActivity(): void {
  try {
    const base = parseSessionPayload(localStorage.getItem(LS_SESSION_KEY));
    if (!base) return;
    const lastActive = Date.now();
    localStorage.setItem(
      LS_SESSION_KEY,
      JSON.stringify({
        roomCode: base.roomCode,
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
