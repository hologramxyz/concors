/* global localStorage, matchMedia, document */
// Resolve appearance before the first paint, without waiting for the application bundle.
(() => {
  let preference = "system";
  try {
    preference = localStorage.getItem("concors.theme") || "system";
  } catch {
    /* Use the built-in appearance when storage is unavailable. */
  }
  const mode =
    preference === "dark" ||
    (preference !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
      ? "dark"
      : "light";
  const root = document.documentElement;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
  try {
    const selection = JSON.parse(localStorage.getItem("concors.color-theme") || "null");
    const cached = JSON.parse(localStorage.getItem("concors.startup-appearance.v1") || "null");
    const color = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
    if (
      cached?.mode === mode &&
      cached.id === (selection?.id || "concors") &&
      color.test(cached.background) &&
      color.test(cached.foreground)
    ) {
      root.style.setProperty("--startup-background", cached.background);
      root.style.setProperty("--startup-foreground", cached.foreground);
    }
  } catch {
    /* Use the built-in appearance when storage is unavailable. */
  }
})();
