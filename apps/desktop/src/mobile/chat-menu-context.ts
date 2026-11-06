import { createContext, useContext } from "react";
import type { useChatRowActions } from "@/agents/chat-row-actions";

export const ChatMenuContext = createContext<ReturnType<typeof useChatRowActions> | null>(null);

/** Desktop's chat row actions for a phone tab menu; null outside `ChatMenuProvider`. */
export function useChatMenu() {
  return useContext(ChatMenuContext);
}
