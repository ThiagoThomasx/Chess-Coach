import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

/**
 * The current minute, updated every minute. Used as a dependency so that
 * time-based counts (a review that becomes due while the app stays open)
 * refresh without waiting for a database write (Sprint 4.5, C3).
 */
export function useMinute(): number {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / MINUTE_MS));
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / MINUTE_MS)), MINUTE_MS);
    return () => clearInterval(id);
  }, []);
  return minute;
}
