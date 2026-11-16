import { Folder } from "lucide-react";
import { useContext, useMemo, useRef, useState } from "react";
import type { WorkspaceProject } from "@concors/protocol";
import { CompactLayoutContext } from "@/components/compact-layout";
import { useCommands } from "@/shortcuts/context";
import { isCompactCommand, type CommandId } from "@/shortcuts/bindings";
import { BoundKeyChips } from "@/shortcuts/key-chips";
import { AgentStartedContext, useAgents } from "@/agents/context";
import { ProviderIcon } from "@/agents/provider-icon";
import { PaneProfileIcon } from "@/workspace/profile-icon";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { useHomePath } from "@/workspace/home-path";
import type { SessionPane } from "@/workspace/session-pane";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { ALL_NAV, type View } from "@/navigation";
import { startSetup } from "@/setup/store";
import type { ThemePreference } from "@/theme/use-theme";
import { matchScore, searchEntries, workspaceEntries, type SearchCategory } from "./index";

interface WorkspaceSearchProps {
  projects: readonly WorkspaceProject[];
  activeProjectId: string | undefined;
  canSelectProject: boolean;
  onSelectProject(id: string): void;
  onSelectPane(target: SessionPane): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  onNavigate(view: View): void;
  onManageMachines(): void;
  onReconnect(): void;
  canReconnect: boolean;
  onSetTheme(theme: ThemePreference): void;
  onSignOut(): void;
}
interface Action {
  id: string;
  title: string;
  keywords: string;
  shortcut?: CommandId;
  run(): void;
}
const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "workspaces", label: "Workspaces" },
  { id: "tabs", label: "Tabs" },
  { id: "commands", label: "Commands" },
] as const;

export function WorkspaceSearch(props: WorkspaceSearchProps) {
  const compact = useContext(CompactLayoutContext);
  const returnFocus = useRef<HTMLElement | null>(null);
  const ranAction = useRef(false);
  const pendingAction = useRef<(() => void) | null>(null);
  return (
    <CommandDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Search"
      // At the top, so it stays put as results come and go. The mobile drawer sits at the bottom.
      className={compact ? "" : "top-[12dvh] max-h-[76dvh] translate-y-0"}
      onOpenAutoFocus={() => {
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        ranAction.current = false;
      }}
      onCloseAutoFocus={(event) => {
        // Wait for Radix to release its focus trap, not just for open=false. Otherwise
        // focusing an already-mounted pane can be swallowed by the closing dialog.
        const action = pendingAction.current;
        pendingAction.current = null;
        if (action) requestAnimationFrame(action);
        // A selected result owns destination focus, including on mobile. Cancelling restores Search.
        if (ranAction.current) {
          event.preventDefault();
          return;
        }
        if (compact) return;
        event.preventDefault();
        const target = returnFocus.current;
        requestAnimationFrame(() => {
          if (
            target?.isConnected &&
            !target.closest("[inert]") &&
            target.getClientRects().length &&
            !document.querySelector('[data-slot="dialog-content"][data-state="open"]')
          )
            target.focus();
        });
      }}
    >
      <SearchContent
        {...props}
        run={(action, ownsFocus = true) => {
          if (pendingAction.current) return;
          ranAction.current = ownsFocus;
          pendingAction.current = action;
          props.onOpenChange(false);
        }}
      />
    </CommandDialog>
  );
}

/** Mounted with the dialog: queries and filters never leak into the next search. */
function SearchContent({
  run,
  ...props
}: WorkspaceSearchProps & { run(action: () => void, ownsFocus?: boolean): void }) {
  const compact = useContext(CompactLayoutContext);
  const commands = useCommands();
  const homePath = useHomePath();
  const agents = useAgents();
  const openAgent = useContext(AgentStartedContext);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [limit, setLimit] = useState(30);
  const input = useRef<HTMLInputElement>(null);
  const entries = useMemo(() => workspaceEntries(props.projects, agents), [props.projects, agents]);
  const results = useMemo(
    () => searchEntries(entries, query, category, props.activeProjectId),
    [entries, query, category, props.activeProjectId],
  );
  const actions: Action[] = [
    {
      id: "settings:machines",
      title: "Go to Machines",
      keywords: "manage computers cloud settings",
      run: () => run(props.onManageMachines),
    },
    ...commands.items
      .filter(
        (item) => item.id !== "search" && item.enabled && (!compact || isCompactCommand(item.id)),
      )
      .map((item): Action => ({
        id: `command:${item.id}`,
        title: item.label,
        keywords: "action command",
        ...(!compact ? { shortcut: item.id } : {}),
        run: () => {
          // Closing a mobile search above the sidebar unregisters workspace commands.
          // Capture the enabled handler before closing, then open its destination next frame.
          const action = commands.getAction(item.id);
          if (action) run(action);
        },
      })),
    ...ALL_NAV.filter((item) => item.view !== "settings" && !item.comingSoon).map(
      (item): Action => ({
        id: `navigate:${item.view}`,
        title: `Go to ${item.label}`,
        keywords: "navigate page",
        run: () => run(() => props.onNavigate(item.view)),
      }),
    ),
    ...(!compact
      ? [
          {
            id: "setup",
            title: "Set up Concors",
            keywords: "onboarding welcome setup tour help getting started machine agents",
            run: () => run(startSetup, false),
          },
        ]
      : []),
    ...(props.canReconnect
      ? [
          {
            id: "reconnect",
            title: "Reconnect to machine",
            keywords: "daemon connection retry",
            run: () => run(props.onReconnect, false),
          },
        ]
      : []),
    {
      id: "sign-out",
      title: "Sign out",
      keywords: "account logout",
      run: () => run(props.onSignOut),
    },
    ...(
      [
        { theme: "light", label: "Light" },
        { theme: "dark", label: "Dark" },
        { theme: "system", label: "System" },
      ] as const
    ).map((item): Action => ({
      id: `theme:${item.theme}`,
      title: `${item.label} theme`,
      keywords: "appearance theme",
      run: () => run(() => props.onSetTheme(item.theme), false),
    })),
  ];
  const matches =
    category === "commands" || (category === "all" && query.trim())
      ? actions
          .map((action) => ({
            action,
            score: matchScore(query, action.title, "", action.keywords),
          }))
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .map(({ action }) => action)
      : [];
  return (
    <Command shouldFilter={false} loop>
      <CommandInput
        ref={input}
        maxLength={200}
        aria-label="Search workspaces and tabs"
        placeholder="Search workspaces and tabs…"
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setLimit(30);
        }}
      />
      <div
        role="group"
        aria-label="Search categories"
        className="mb-2 flex shrink-0 gap-1 overflow-x-auto"
      >
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={category === item.id}
            className="min-h-9 shrink-0 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
            onClick={() => {
              setCategory(item.id);
              setLimit(30);
              input.current?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <CommandList aria-label="Search results">
        {results.length > 0 && (
          <CommandGroup
            heading={
              category === "workspaces"
                ? "Workspaces"
                : category === "tabs"
                  ? "Agents and terminals"
                  : "Workspaces and tabs"
            }
          >
            {results.slice(0, limit).map((entry) => (
              <SidebarTooltip
                key={entry.id}
                place="menu"
                content={entry.kind === "workspace" ? homePath(entry.detail) : undefined}
              >
                {/* cmdk replaces an item's onPointerMove, which a tooltip trigger needs. */}
                <div role="presentation">
                  <CommandItem
                    value={entry.id}
                    data-search-result={entry.kind}
                    data-search-project-id={entry.projectId}
                    data-search-pane-id={entry.target?.paneId}
                    disabled={!props.canSelectProject}
                    onSelect={() =>
                      run(() =>
                        entry.target
                          ? props.onSelectPane(entry.target)
                          : entry.kind === "closed-chat" && entry.agent && openAgent
                            ? openAgent(entry.agent.id)
                            : props.onSelectProject(entry.projectId),
                      )
                    }
                    className="flex-nowrap gap-3"
                  >
                    {entry.kind === "workspace" ? (
                      <Folder aria-hidden="true" />
                    ) : entry.agent ? (
                      <ProviderIcon provider={entry.agent.provider} />
                    ) : entry.profile ? (
                      <PaneProfileIcon profile={entry.profile} />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{entry.title}</span>
                      {(compact || entry.kind !== "workspace") && entry.detail !== entry.title && (
                        <span
                          className="block truncate text-xs text-muted-foreground"
                          style={
                            entry.kind === "workspace"
                              ? { direction: "rtl", textAlign: "left" }
                              : undefined
                          }
                        >
                          <bdi dir="ltr">{entry.detail}</bdi>
                        </span>
                      )}
                    </span>
                    {entry.kind === "closed-chat" && (
                      <span className="shrink-0 text-xs text-muted-foreground">Closed chat</span>
                    )}
                  </CommandItem>
                </div>
              </SidebarTooltip>
            ))}
            {results.length > limit && (
              <CommandItem value="show-more" onSelect={() => setLimit((value) => value + 30)}>
                Show more results ({results.length - limit} remaining)
              </CommandItem>
            )}
          </CommandGroup>
        )}
        {matches.length > 0 && (
          <CommandGroup heading="Commands">
            {matches.map((action) => (
              <CommandItem key={action.id} value={action.id} onSelect={action.run}>
                {action.title}
                {action.shortcut && (
                  <CommandShortcut className="flex">
                    <BoundKeyChips id={action.shortcut} />
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!results.length && !matches.length && (
          <div role="status" className="px-3 py-8 text-center text-sm text-muted-foreground">
            {!props.projects.length && !props.canSelectProject
              ? "Connect a machine to search its workspaces and tabs."
              : query.trim()
                ? "No results."
                : category === "tabs"
                  ? "No tabs on this machine yet."
                  : "No workspaces on this machine yet."}
          </div>
        )}
      </CommandList>
      {!props.canSelectProject && (
        <p className="shrink-0 px-2 pt-3 text-xs text-muted-foreground">
          Reconnect to open workspace results.
        </p>
      )}
    </Command>
  );
}
