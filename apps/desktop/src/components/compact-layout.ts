import { createContext } from "react";
/** Shared UI keeps desktop behavior by default; phone hosts opt into touch/keyboard adaptations. */
export const CompactLayoutContext = createContext(false);
export const PaneVisibilityContext = createContext(true);
