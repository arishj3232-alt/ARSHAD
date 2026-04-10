import { useRef, useCallback } from "react";

/**
 * Sliding-window rate limiter.
 * Returns a `check()` function that returns true if the action is allowed,
 * false if it would exceed maxCount within windowMs milliseconds.
 */
export function useRateLimit(maxCount: number, windowMs: number) {
  const timestampsRef = useRef<number[]>([]);

  const check = useCallback((): boolean => {
    const now = Date.now();
    // Drop timestamps outside the current window
    timestampsRef.current = timestampsRef.current.filter((t) => now - t < windowMs);
    if (timestampsRef.current.length >= maxCount) return false;
    timestampsRef.current.push(now);
    return true;
  }, [maxCount, windowMs]);

  const reset = useCallback(() => { timestampsRef.current = []; }, []);

  return { check, reset };
}
