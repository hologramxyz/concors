import { createRoot } from "react-dom/client";
import { MobileApp } from "./shell";
import { hostAction, sendHost } from "./bridge";
import "../styles.css";
import "./mobile.css";

// Opaque-origin offline renderers cannot use the browser clipboard directly.
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: {
    writeText: async (text: string) => {
      await hostAction({ kind: "clipboard", text });
    },
  },
});
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!link) return;
  event.preventDefault();
  void hostAction({ kind: "open-url", url: link.getAttribute("href") ?? "" }).catch(
    () => undefined,
  );
});
const root = document.getElementById("root");
if (!root) throw new Error("Missing mobile UI root");
createRoot(root).render(<MobileApp />);
sendHost({ type: "ready" });
