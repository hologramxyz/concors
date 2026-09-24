import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WindowChromeProvider } from "./window/provider";
import { suppressNativeContextMenu } from "./window/context-menu";

import { App } from "./App.tsx";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing #root element");
}

suppressNativeContextMenu();

createRoot(container).render(
  <StrictMode>
    <WindowChromeProvider>
      <App />
    </WindowChromeProvider>
  </StrictMode>,
);
