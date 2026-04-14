import { useState, useEffect, useRef } from "react";
import { collection, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Matches `SessionUser` in useSession (kept local to avoid circular imports). */
export type PresenceUser = {
  id: string;
  name: string;
  role: "shelly" | "arshad" | null;
  joinedAt: Date | null;
  online: boolean;
  lastSeen: Date | null;
  typing?: boolean;
};

/** Heartbeat interval (client writes lastSeenTs). */
export const PRESENCE_HEARTBEAT_MS = 5_000;
/** Consider user offline if lastSeenTs older than this. */
export const PRESENCE_ONLINE_MAX_AGE_MS = 15_000;
const PRESENCE_DEBOUNCE_MS = 150;
const TYPING_FRESH_MS = 2800;

/** Normalize client number millis or Firestore Timestamp. */
export function lastSeenTsToMillis(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw instanceof Timestamp) return raw.toMillis();
  if (raw && typeof raw === "object" && "toMillis" in raw && typeof (raw as { toMillis: unknown }).toMillis === "function") {
    const ms = (raw as { toMillis: () => number }).toMillis();
    return typeof ms === "number" && Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

/** Firestore is source of truth: must be explicitly online AND recently seen. */
export function isPresenceLive(data: Record<string, unknown>, nowMs: number): boolean {
  if (data.online !== true) return false;
  const ts = lastSeenTsToMillis(data.lastSeenTs);
  return ts > 0 && nowMs - ts < PRESENCE_ONLINE_MAX_AGE_MS;
}

function displayNameFromDoc(data: Record<string, unknown>): string {
  const n = typeof data.name === "string" ? data.name.trim() : "";
  if (n) return n;
  const role = data.role;
  if (role === "shelly") return "Tanvi";
  if (role === "arshad") return "Arshad";
  return "Participant";
}

export function usePresence(_currentUserId: string | null, roomCode: string | null) {
  const [presence, setPresence] = useState<Record<string, PresenceUser>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Record<string, PresenceUser>>({});

  useEffect(() => {
    if (!roomCode) return undefined;
    try {
      const presenceCol = collection(db, "rooms", roomCode, "presence");

      const unsub = onSnapshot(presenceCol, (snap) => {
        const users: Record<string, PresenceUser> = {};
        const now = Date.now();

        snap.docs.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const ts = lastSeenTsToMillis(data.lastSeenTs);
          const live = isPresenceLive(data, now);
          const typingAt = typeof data.typingAt === "number" ? data.typingAt : 0;
          const typingFresh =
            live &&
            data.typing === true &&
            typingAt > 0 &&
            now - typingAt < TYPING_FRESH_MS;
          users[d.id] = {
            id: d.id,
            name: displayNameFromDoc(data),
            role: data.role === "shelly" || data.role === "arshad" ? data.role : null,
            joinedAt: null,
            online: live,
            lastSeen: ts ? new Date(ts) : null,
            typing: typingFresh,
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
