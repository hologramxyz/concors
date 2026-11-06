import type { ReactNode } from "react";
import { useChatRowActions } from "@/agents/chat-row-actions";
import { ChatMenuContext } from "./chat-menu-context";

/**
 * Desktop's chat row actions for every tab menu on the phone: one undo at a time, and one toast,
 * however many menus are open. Nothing here decides when an action is offered; desktop's rules do.
 */
export function ChatMenuProvider({
  children,
  ...options
}: Parameters<typeof useChatRowActions>[0] & { children: ReactNode }) {
  const menu = useChatRowActions(options);
  return (
    <ChatMenuContext value={menu}>
      {/* Desktop's toast as it is; the stylesheet only moves it below the phone's header. */}
      {menu.toast && <div className="mobile-undo-toast">{menu.toast}</div>}
      {children}
    </ChatMenuContext>
  );
}
