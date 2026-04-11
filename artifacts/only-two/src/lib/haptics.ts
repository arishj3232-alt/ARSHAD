/** Short haptic pulse when supported (mobile). */
export function vibrateShort(ms = 50): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    /* noop */
  }
}
