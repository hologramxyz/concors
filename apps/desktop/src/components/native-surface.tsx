import { createContext, useContext, useId, useLayoutEffect, type RefObject } from "react";
import type { NativeSurfaceContent, NativeSurfaceEvent } from "@concors/client-core";

export interface NativeSurfaceRegistration {
  element: HTMLElement;
  content: NativeSurfaceContent;
  onEvent(event: NativeSurfaceEvent): void;
}
export const NativeSurfaceContext = createContext<{
  update(id: string, registration: NativeSurfaceRegistration): void;
  remove(id: string): void;
} | null>(null);

/** Desktop/web render normally; the native host replaces only opted-in surfaces. */
export function useNativeSurface(
  ref: RefObject<HTMLElement | null>,
  content: NativeSurfaceContent,
  onEvent: (event: NativeSurfaceEvent) => void,
) {
  const host = useContext(NativeSurfaceContext);
  const id = useId();
  useLayoutEffect(() => {
    if (host && ref.current) host.update(id, { element: ref.current, content, onEvent });
  });
  useLayoutEffect(() => () => host?.remove(id), [host, id]);
  return !!host;
}
