import * as WebBrowser from "expo-web-browser";

/**
 * Opens a machine's preview inside the app, in the system's in-app browser (SFSafariViewController
 * on iOS, a Custom Tab on Android).
 *
 * Not a web view of our own: a preview runs whatever the machine serves, and here it cannot reach
 * the app or the renderer that holds the machine's access, and keeps its sign-in cookie apart from
 * Safari's. Like the desktop, it opens without asking: the person chose a preview of their machine.
 */
export function openPreviewInApp(value: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Only secure previews can be opened");
  // Not awaited: the browser's promise settles only when the person closes it, and the renderer's
  // request would time out while they are still reading the preview.
  void WebBrowser.openBrowserAsync(url.href, {
    // A card over the chat that a drag down puts away, as other apps open links, not a screen
    // that hides where the person came from.
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    // On Android the tab stays in the app's task instead of becoming its own entry in recents.
    createTask: false,
  }).catch(() => undefined);
}
