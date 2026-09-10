import { useLayoutEffect, useState, type ReactNode } from "react";
import type { MobileState, NativeSurface } from "@concors/client-core";
import { NativeSurfaceContext, type NativeSurfaceRegistration } from "@/components/native-surface";
import { hostAction, sendHost, subscribeHost } from "./bridge";

/** Geometry travels out; a bounded UI event travels back. Credentials never enter this layer. */
function createRegistry() {
  const entries = new Map<string, NativeSurfaceRegistration>();
  let schedule: () => void = () => undefined;
  return {
    entries,
    setSchedule: (next: () => void) => {
      schedule = next;
    },
    context: {
      update(id: string, value: NativeSurfaceRegistration) {
        entries.set(id, value);
        schedule();
      },
      remove(id: string) {
        entries.delete(id);
        schedule();
      },
    },
  };
}
export function NativeSurfaces({ host, children }: { host: MobileState; children: ReactNode }) {
  const [registry] = useState(createRegistry);
  useLayoutEffect(() => {
    if (!host.nativeChrome) return;
    let frame = 0,
      trackingUntil = 0,
      last = "";
    let visible = new Set<string>();
    const measure = () => {
      frame = 0;
      const surfaces: NativeSurface[] = [];
      // DOM sheets remain authoritative; native views must not cover their backdrop or focus trap.
      const modal = document.querySelector(
        '[role="dialog"][data-state="open"], [role="menu"], [role="listbox"], [data-slot="popover-content"][data-state="open"]',
      );
      if (!modal)
        for (const [id, item] of registry.entries) {
          const element = item.element;
          if (
            !element.isConnected ||
            element.closest("[inert], [hidden]") ||
            element.parentElement?.closest('[aria-hidden="true"]')
          )
            continue;
          const rect = element.getBoundingClientRect();
          if (
            !rect.width ||
            !rect.height ||
            rect.bottom <= 0 ||
            rect.top >= innerHeight ||
            rect.right <= 0 ||
            rect.left >= innerWidth
          )
            continue;
          surfaces.push({
            id,
            content: item.content,
            frame: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          });
        }
      visible = new Set(surfaces.map((item) => item.id));
      const message = {
        type: "native-surfaces" as const,
        scope: host.scope,
        connectionId: host.connectionId,
        surfaces,
        viewport: { width: innerWidth, height: innerHeight },
      };
      const serialized = JSON.stringify(message);
      if (serialized !== last) {
        last = serialized;
        sendHost(message);
      }
      if (performance.now() < trackingUntil) frame = requestAnimationFrame(measure);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const track = () => {
      trackingUntil = performance.now() + 400;
      schedule();
    };
    registry.setSchedule(schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    const resize = new ResizeObserver(track);
    resize.observe(document.documentElement);
    const dismissKeyboard = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest('[data-native-composer], input, textarea, [contenteditable="true"]')
      )
        return;
      void hostAction({ kind: "dismiss-keyboard" }).catch(() => undefined);
    };
    document.addEventListener("pointerdown", dismissKeyboard, true);
    document.addEventListener("transitionrun", track, true);
    document.addEventListener("animationstart", track, true);
    document.addEventListener("pointermove", schedule, true);
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", track);
    const unsubscribe = subscribeHost((message) => {
      if (
        message.type !== "native-event" ||
        message.scope !== host.scope ||
        message.connectionId !== host.connectionId ||
        !visible.has(message.surfaceId)
      )
        return;
      const item = registry.entries.get(message.surfaceId);
      if (!item || item.element.closest("[inert], [hidden]")) return;
      if (message.event.kind === "swipe") {
        document.dispatchEvent(
          new CustomEvent("concors-native-swipe", { detail: message.event.direction }),
        );
      } else item.onEvent(message.event);
    });
    track();
    return () => {
      registry.setSchedule(() => undefined);
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      unsubscribe();
      document.removeEventListener("transitionrun", track, true);
      document.removeEventListener("animationstart", track, true);
      document.removeEventListener("pointermove", schedule, true);
      document.removeEventListener("pointerdown", dismissKeyboard, true);
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", track);
    };
  }, [host.nativeChrome, host.scope, host.connectionId, registry]);
  return (
    <NativeSurfaceContext value={host.nativeChrome ? registry.context : null}>
      {children}
    </NativeSurfaceContext>
  );
}
