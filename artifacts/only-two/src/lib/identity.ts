/** localStorage key — never remove this in idle/session cleanup. */
export const PERSISTENT_USER_ID_STORAGE_KEY = "onlytwo-identity-id";

/** Same tab process when localStorage is unavailable (private mode, quota, etc.). */
let memoryFallbackUserId: string | null = null;

/** Stable per-browser identity (UUID), persisted in localStorage with in-memory fallback. */
export function getOrCreatePersistentUserId(): string {
  try {
    let id = localStorage.getItem(PERSISTENT_USER_ID_STORAGE_KEY);
    if (!id || !id.trim()) {
      id = crypto.randomUUID();
      localStorage.setItem(PERSISTENT_USER_ID_STORAGE_KEY, id);
    }
    return id.trim();
  } catch {
    if (!memoryFallbackUserId) {
      memoryFallbackUserId = crypto.randomUUID();
    }
    return memoryFallbackUserId;
  }
}
