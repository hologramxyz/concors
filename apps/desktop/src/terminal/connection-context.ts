import { createContext } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
export const TerminalConnectionContext = createContext<DaemonConnection | null>(null);
