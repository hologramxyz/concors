import { useEffect, useState } from "react";

/** Seconds since `since`, ticking while `running`. */
export function useElapsed(since: string, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
}
