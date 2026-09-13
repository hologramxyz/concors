import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WindowChromeProvider } from "./window/provider";

import { App } from "./App.tsx";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing #root element");
}

createRoot(container).render(
  <StrictMode>
    <WindowChromeProvider>
      <App />
    </WindowChromeProvider>
  </StrictMode>,
);
