import type { MobileHostMessage, MobileRendererMessage, MobileState } from "@concors/client-core";
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
/** Never let an older bridge echo erase newer locally typed text. */
export function reconcileNativeDraft(
  local: string,
  sequence: number,
  draft: string,
  acknowledged: number,
) {
  return acknowledged >= sequence ? draft : local;
}
