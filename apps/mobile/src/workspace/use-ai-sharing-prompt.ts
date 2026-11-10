import { useCallback, useEffect, useRef, useState } from "react";
import type { AISharingDisclosure } from "./ai-sharing";

/** A reply belongs to one prompt on one connection; leaving it never grants permission. */
export function useAISharingPrompt(connectionId: string | null) {
  const sequence = useRef(0);
  const pending = useRef<{ id: number; resolve(allowed: boolean): void } | null>(null);
  const [prompt, setPrompt] = useState<{ id: number; disclosure: AISharingDisclosure } | null>(
    null,
  );
  const ask = useCallback((disclosure: AISharingDisclosure) => {
    pending.current?.resolve(false);
    const id = ++sequence.current;
    return new Promise<boolean>((resolve) => {
      pending.current = { id, resolve };
      setPrompt({ id, disclosure });
    });
  }, []);
  const answer = useCallback((id: number, allowed: boolean) => {
    const request = pending.current;
    if (request?.id !== id) return;
    pending.current = null;
    setPrompt(null);
    request.resolve(allowed);
  }, []);
  useEffect(() => {
    setPrompt(null);
    return () => {
      pending.current?.resolve(false);
      pending.current = null;
    };
  }, [connectionId]);
  return { prompt, ask, answer };
}
