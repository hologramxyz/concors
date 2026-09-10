import type { ApiClient } from "@concors/api-client";
export async function enablePush(_api: ApiClient, _userId: string): Promise<void> {
  throw new Error("Push notifications are available in the iOS and Android builds.");
}
export async function disablePush(_api: ApiClient): Promise<void> {
  /* No push subscription in the browser preview. */
}
export async function pushEnabled(_userId: string): Promise<boolean> {
  return false;
}
export function usePushNavigation(
  _api: ApiClient,
  _userId: string | undefined,
  _supported: boolean,
): void {
  /* Native only. */
}
