import type {
  MobileHostMessage,
  MobileRendererMessage,
  MobileState,
  NativeSurface,
} from "@concors/client-core";
export type NativeSurfaceSnapshot = Extract<MobileRendererMessage, { type: "native-surfaces" }>;
export interface NativeChromeProps {
  host: MobileState | null;
  snapshot: NativeSurfaceSnapshot | null;
  send(message: MobileHostMessage): void;
}
export function currentNativeSnapshot(
  host: MobileState | null,
  snapshot: NativeSurfaceSnapshot | null,
) {
  return (
    !!host?.nativeChrome &&
    host.scope === snapshot?.scope &&
    host.connectionId === snapshot.connectionId
  );
}

/** Map web geometry once; a clip never changes the size of the glass button itself. */
export function nativeSurfaceLayout(
  surface: NativeSurface,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
) {
  const scale = size.width ? size.width / viewport.width : 1;
  const shift =
    surface.content.kind === "composer" && size.height ? size.height - viewport.height : 0;
  const clip = surface.clip ?? surface.frame;
  return {
    clip: {
      left: clip.x * scale,
      top: clip.y + shift,
      width: clip.width * scale,
      height: clip.height,
    },
    content: {
      left: (surface.frame.x - clip.x) * scale,
      top: surface.frame.y - clip.y,
      width: surface.frame.width * scale,
      height: surface.frame.height,
    },
  };
}
/** Never let an older bridge echo erase newer locally typed text. */
export function reconcileNativeDraft(
  local: string,
  sequence: number,
  draft: string,
  acknowledged: number,
) {
  return acknowledged >= sequence ? draft : local;
}

/**
 * The context ring's arc, drawn as desktop's SVG draws it: one dash the length of the circle, offset
 * so that only the used share shows. An offset rather than a shorter dash, because SwiftUI animates
 * a stroke's phase but not its dash lengths.
 */
export function contextRingStroke(percent: number, diameter: number, lineWidth: number) {
  const circumference = Math.PI * (diameter - lineWidth);
  const used = Math.min(100, Math.max(0, percent)) / 100;
  return { lineWidth, dash: [circumference, circumference], dashPhase: circumference * (1 - used) };
}
/** What the context button says it holds, in desktop's words. */
export function contextRingValue(percent: number | null) {
  return percent === null ? "Usage pending" : `${Math.round(percent)}% context used`;
}
