/** Missing browser APIs and synchronous failures must reach the caller's error UI too. */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable.");
  await navigator.clipboard.writeText(text);
}

export async function readText(): Promise<string> {
  if (!navigator.clipboard?.readText) throw new Error("Clipboard access is unavailable.");
  return navigator.clipboard.readText();
}
