import type { BrowserContext } from "@playwright/test";

/**
 * Shows the app's Linux and Windows shortcut labels on any host, for specs that assert them: a Mac
 * host would otherwise show its own. shortcuts.spec.ts covers the Mac labels on any host in turn.
 */
export function reportNonMac(context: BrowserContext) {
  return context.addInitScript(() =>
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      get: () => "Linux x86_64",
    }),
  );
}
