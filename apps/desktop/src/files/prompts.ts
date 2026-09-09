import { createContext, useContext } from "react";

/** Native/offline hosts supply in-app dialogs without enabling browser modal privileges. */
export const FilePromptsContext = createContext<{
  confirm(message: string): boolean | Promise<boolean>;
  notify(message: string): void;
}>({ confirm: (message) => window.confirm(message), notify: (message) => window.alert(message) });
export const useFilePrompts = () => useContext(FilePromptsContext);
