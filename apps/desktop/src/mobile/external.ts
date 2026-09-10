import { hostAction } from "./bridge";
export async function openExternal(url: string) {
  await hostAction({ kind: "open-url", url });
}
