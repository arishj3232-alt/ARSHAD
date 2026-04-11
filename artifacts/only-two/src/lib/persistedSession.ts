export const LS_SESSION_KEY = "session";
export const LS_LAST_ACTIVE_KEY = "lastActive";

export type PersistedSession = {
  roomCode: string;
  role: "shelly" | "arshad";
  userId: string;
};

export function parsePersistedSession(raw: string | null): PersistedSession | null {
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
    return { roomCode: rc, role, userId };
  } catch {
    return null;
  }
}

export function writePersistedSession(roomCode: string, role: "shelly" | "arshad", userId: string): void {
  try {
    localStorage.setItem(LS_SESSION_KEY, JSON.stringify({ roomCode, role, userId }));
  } catch {
    /* quota / private mode */
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
