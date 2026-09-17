import { hostAction } from "./bridge";
import type { ProcessPreview } from "@concors/protocol";
export async function openExternal(url: string) {
  await hostAction({ kind: "open-url", url });
}
export async function openPreview(preview: ProcessPreview, _url: string) {
  await hostAction({ kind: "open-preview", preview });
}
