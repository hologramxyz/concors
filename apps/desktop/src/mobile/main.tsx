import { createRoot } from "react-dom/client";
import { MobileApp } from "./shell";
import { hostAction, sendHost } from "./bridge";
import { markPointerFocus } from "@/lib/pointer-focus";
import { installRandomUUID } from "./platform";
import "../styles.css";
import "./mobile.css";
installRandomUUID(crypto);
markPointerFocus();

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
  if (event.defaultPrevented) return;
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
