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

/** How far Liquid Glass casts its soft shadow past its own shape. */
const GLASS_SHADOW = 48;

/**
 * Map web geometry once; a clip never changes the size of the glass button itself. Only a panel
 * edge cuts a control: elsewhere the clip leaves room for the glass's shadow, which a clip at the
 * control's own frame would cut into a faint square behind its rounded corners.
 */
export function nativeSurfaceLayout(
  surface: NativeSurface,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
) {
  const scale = size.width ? size.width / viewport.width : 1;
  const shift =
    surface.content.kind === "composer" && size.height ? size.height - viewport.height : 0;
  const { frame } = surface;
  const cut = surface.clip ?? frame;
  const left = cut.x > frame.x ? cut.x : frame.x - GLASS_SHADOW;
  const top = cut.y > frame.y ? cut.y : frame.y - GLASS_SHADOW;
  const right =
    cut.x + cut.width < frame.x + frame.width
      ? cut.x + cut.width
      : frame.x + frame.width + GLASS_SHADOW;
  const bottom =
    cut.y + cut.height < frame.y + frame.height
      ? cut.y + cut.height
      : frame.y + frame.height + GLASS_SHADOW;
  return {
    clip: {
      left: left * scale,
      top: top + shift,
      width: (right - left) * scale,
      height: bottom - top,
    },
    content: {
      left: (frame.x - left) * scale,
      top: frame.y - top,
      width: frame.width * scale,
      height: frame.height,
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
