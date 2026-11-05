import {
  ArrowRightLeft,
  Clock,
  Ellipsis,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { useContext, useRef, useState } from "react";
import { agentProviderName, type AgentInfo } from "@concors/protocol";
import { cn } from "cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrailleSpinner } from "@/agents/activity";
import { AGENT_DOT_COLOR, type AgentDot, type AgentStatus } from "@/agents/agent-status";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { BackgroundTerminalsContext } from "@/terminal/background-terminals";
import { shortAge } from "@/lib/format-date";
import {
  rowAgentStatus,
  rowPinned,
  rowState,
  rowStatusLabel,
  type SidebarRow,
} from "./sidebar-rows";

/**
 * Sits under the workspace's icon, one indent in, so the row reads as the workspace's. The chat's
 * braille spinner while an agent replies, open or closed (closed rows are told apart by their
 * muted name), a grey dot while a terminal runs, its `AgentDot` until it has been opened, and
 * nothing otherwise.
 */
function RowDot({ row, status }: { row: SidebarRow; status: AgentStatus | undefined }) {
  const state = rowState(row);
  const background = status?.background ?? 0;
  return (
    <span
      role={status ? "img" : undefined}
      aria-label={status ? `Agent status: ${status.status}` : undefined}
      data-provider={status?.provider}
      data-row-state={state}
      data-background-agents={background || undefined}
      // The workspace icon is 20px, not a spacing step, so titles line up with workspace names.
      className="flex size-[20px] shrink-0 items-center justify-center"
    >
      {state === "working" ? (
        <BrailleSpinner />
      ) : state === "running" ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground" />
      ) : (
        state && <SidebarDot dot={state} />
      )}
    </span>
  );
}

export function SidebarDot({ dot }: { dot: AgentDot }) {
  return <span aria-hidden="true" className={cn("size-1.5 rounded-full", AGENT_DOT_COLOR[dot])} />;
}

/**
 * One tab, closed chat, or background terminal under its workspace. Rows have no close button:
 * closing is the tab's job, and what was closed stays here, muted, while it can be opened again.
 */
export function SidebarTabRow({
  row,
  now,
  selected,
  scheduled,
  onOpen,
  onRename,
  onFork,
  onPin,
  onDelete,
  moveTargets = [],
  onMove,
  onMoveDragStart,
  onMoveDragEnd,
}: {
  row: SidebarRow;
  now: number;
  selected: boolean;
  /** A schedule runs prompts in this chat. */
  scheduled: boolean;
  onOpen: () => void;
  /** Absent when the row cannot be renamed right now. */
  onRename: ((name: string) => void) | undefined;
  /** Absent for terminals, and for a chat that cannot be forked right now. */
  onFork: (() => void) | undefined;
  /** Pins or unpins the row's chat; absent for terminals. */
  onPin?: (() => void) | undefined;
  /** Asks to delete the row's chat; absent for terminals. */
  onDelete?: (() => void) | undefined;
  /** The workspaces it could move to. */
  moveTargets?: readonly { id: string; name: string }[];
  /** Moves the row to a workspace; absent when it cannot move. */
  onMove?: ((projectId: string) => void) | undefined;
  onMoveDragStart?: (() => void) | undefined;
  onMoveDragEnd?: (() => void) | undefined;
}) {
  const closed = row.kind !== "tab";
  const title = row.kind === "closed" ? row.chat.title : row.title;
  const status = rowAgentStatus(row);
  const background = useContext(BackgroundTerminalsContext);
  const terminal = row.kind === "terminal" && background ? row.terminal : undefined;
  // Mirrors the tab rename: the ref stops blur after Enter/Escape from committing a second time.
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameRef = useRef<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const setRename = (value: string | null) => {
    renameRef.current = value;
    setRenaming(value);
  };
  const commitRename = () => {
    const value = renameRef.current;
    if (value === null) return;
    setRename(null);
    onRename?.(value);
  };
  const providerName =
    status?.providerName ??
    (row.kind === "closed"
      ? (row.chat.agent.providerLabel ?? agentProviderName(row.chat.agent.provider))
      : undefined);
  const statusLabel = rowStatusLabel(row);
  const pinned = rowPinned(row);
  const canMove = !!onMove && moveTargets.length > 0;
  const actions = !!onRename || !!onFork || !!onPin || !!onDelete || !!terminal || canMove;
  const button = (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      data-agent-id={status?.id ?? (row.kind === "closed" ? row.chat.agent.id : undefined)}
      data-agent-closed={row.kind === "closed" || undefined}
      data-sidebar-tab-id={row.kind === "tab" ? row.tabId : undefined}
      data-background-terminal={row.kind === "terminal" ? row.terminal.id : undefined}
      onClick={onOpen}
      className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pl-2 text-left text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <RowDot row={row} status={status} />
      <span className={cn("min-w-0 flex-1 truncate", closed && "text-muted-foreground")}>
        {/* Only the name opens the details, so the rest of the row stays free for its "…" menu. */}
        <SidebarTooltip
          content={
            <>
              <p className="font-medium break-words">{title}</p>
              {providerName && <p className="opacity-75">{providerName}</p>}
              {statusLabel && <p className="opacity-75">{statusLabel}</p>}
            </>
          }
        >
          <span>{title}</span>
        </SidebarTooltip>
      </span>
      {pinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />}
      {scheduled && (
        <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Scheduled agent" />
      )}
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {shortAge(row.time, now)}
      </span>
    </button>
  );
  return (
    <li
      data-sidebar-row={row.key}
      draggable={canMove && renaming === null}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        // Firefox starts no drag without data, and the row's name is what it is if dropped elsewhere.
        event.dataTransfer.setData("text/plain", title);
        onMoveDragStart?.();
      }}
      onDragEnd={onMoveDragEnd}
      className={cn(
        "group/row flex items-center rounded-md hover:bg-sidebar-accent/70 has-[[aria-expanded=true]]:bg-sidebar-accent/70",
        selected &&
          "bg-sidebar-accent hover:bg-sidebar-accent has-[[aria-expanded=true]]:bg-sidebar-accent",
      )}
    >
      {renaming !== null ? (
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2">
          <span aria-hidden="true" className="w-[20px] shrink-0" />
          <input
            ref={renameInput}
            aria-label="Tab name"
            autoFocus
            value={renaming}
            maxLength={120}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRename(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              // Keep Enter, Escape and app shortcuts away from the handlers outside the sidebar.
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRename(null);
              }
            }}
            className="min-w-0 flex-1 rounded bg-background px-1.5 py-0.5 text-ui text-foreground ring-1 ring-ring outline-none"
          />
        </div>
      ) : (
        button
      )}
      {actions ? (
        <DropdownMenu>
          <SidebarTooltip content="Tab options">
            <DropdownMenuTrigger
              aria-label={`Actions for ${title}`}
              className={cn(
                "mobile-tap-target flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:text-sidebar-foreground aria-expanded:opacity-100 [@media(hover:none)]:opacity-100",
                // Kept mounted while renaming so closing the menu can hand focus to the input.
                renaming !== null && "invisible",
              )}
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
          </SidebarTooltip>
          <DropdownMenuContent
            align="start"
            className="w-56"
            onCloseAutoFocus={(event) => {
              // The menu's focus trap outlives the input's autoFocus, so hand focus over here
              // instead of returning it to the trigger.
              if (renameRef.current === null) return;
              event.preventDefault();
              renameInput.current?.focus();
            }}
          >
            {onPin && (
              <DropdownMenuItem onSelect={onPin}>
                {pinned ? (
                  <>
                    <PinOff /> Unpin
                  </>
                ) : (
                  <>
                    <Pin /> Pin
                  </>
                )}
              </DropdownMenuItem>
            )}
            {onRename && (
              <DropdownMenuItem onSelect={() => setRename(title)}>
                <Pencil /> Rename tab
              </DropdownMenuItem>
            )}
            {onFork && (
              <DropdownMenuItem onSelect={onFork}>
                <GitFork /> Fork chat
              </DropdownMenuItem>
            )}
            {canMove && (
              // Dragging has no keyboard or touch equivalent; this is the same move.
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft /> Move to workspace
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 max-w-72 overflow-y-auto">
                  {moveTargets.map((target) => (
                    <DropdownMenuItem key={target.id} onSelect={() => onMove?.(target.id)}>
                      <span className="truncate">{target.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            )}
            {terminal && (
              <>
                <DropdownMenuItem onSelect={() => background?.reopen(terminal)}>
                  <RotateCcw /> Reopen
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => background?.stop(terminal)}>
                  <Square /> Stop
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span aria-hidden="true" className="mobile-row-spacer size-6 shrink-0" />
      )}
    </li>
  );
}

/** Chats whose workspace was removed: listed apart and muted, since there is nowhere to open them. */
export function UnavailableChats({ chats, now }: { chats: readonly AgentInfo[]; now: number }) {
  if (!chats.length) return null;
  return (
    <li>
      <p className="flex h-8 items-center px-2 text-ui text-muted-foreground">
        Unavailable workspace
      </p>
      <ul className="space-y-0.5">
        {chats.map((chat) => (
          <li
            key={chat.id}
            data-agent-id={chat.id}
            className="flex h-8 items-center gap-2 px-2 text-ui text-muted-foreground"
          >
            <span aria-hidden="true" className="w-[20px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {chat.paneName ?? chat.tabName ?? chat.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums">{shortAge(chat.updatedAt, now)}</span>
            <span aria-hidden="true" className="mobile-row-spacer size-6 shrink-0" />
          </li>
        ))}
      </ul>
    </li>
  );
}
