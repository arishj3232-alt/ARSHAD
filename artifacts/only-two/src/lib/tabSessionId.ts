/** Per browser tab — separate from composite `onlytwo-user-id` (`${room}_${role}`). */
export const TAB_SESSION_STORAGE_KEY = "onlytwo-tab-session-id";

export function getOrCreateTabSessionId(): string {
  let id = sessionStorage.getItem(TAB_SESSION_STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, id);
  }
  return id;
}
