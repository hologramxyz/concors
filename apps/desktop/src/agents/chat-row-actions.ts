import { useContext } from "react";
import type { AgentInfo, WorkspaceOperation } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useChatActions } from "./chat-actions";
import { useDeferredDelete } from "./deferred-delete";
import { canFork, useForkChat } from "./fork";

/**
 * What a chat row's menu can do, on desktop's sidebar and the phone's tab menus alike, so both
 * offer an action under the same rules. Each action is absent when it cannot be done right now.
 * Asking before deleting is the caller's: it shows `DeleteChatDialog`, then calls `remove`.
 */
export function useChatRowActions({
  canEdit,
  execute,
  isSelected,
  onReopenSelected,
}: {
  canEdit: boolean;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  /** Whether the chat's tab is the one shown. */
  isSelected: (id: string) => boolean;
  /** Opens the chat again and shows it, when Undo brings back the chat that was shown. */
  onReopenSelected: (id: string) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const forkChat = useForkChat();
  const chatActions = useChatActions(execute);
  const deferred = useDeferredDelete({ actions: chatActions, isSelected, onReopenSelected });
  const fork = (chat: AgentInfo | undefined) =>
    canEdit && connection?.state.status === "ready" && canFork(chat)
      ? () =>
          void forkChat(chat).catch((error: unknown) =>
            console.error("Could not fork the chat", error),
          )
      : undefined;
  const pin = (chat: AgentInfo | undefined) =>
    canEdit && chatActions && chat
      ? () =>
          void chatActions
            .pin(chat, !chat.pinned)
            .catch((error: unknown) => console.error("Could not pin the chat", error))
      : undefined;
  return {
    /** The machine's chat actions; null until it can pin and delete. */
    actions: chatActions,
    fork,
    pin,
    /** Whether a chat can be deleted now; the confirm dialog asks first. */
    canDelete: canEdit && !!chatActions,
    remove: deferred.remove,
    /** Chats waiting out their undo, which lists leave out already. */
    hidden: deferred.hidden,
    toast: deferred.toast,
  };
}
