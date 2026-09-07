import { Folder, Plus, Search, Settings } from "lucide-react";
import { cn } from "cn";
import type { WorkspaceSnapshot } from "@concors/protocol";
import type { SignedInAuth } from "@/auth/auth-state";
import { AccountMenu } from "@/components/account-menu";
import { PRIMARY_NAV, type View } from "@/navigation";
import { MachineSwitcher } from "@/workspace/machine-switcher";
import type { MachineConnection } from "@/workspace/machines";

interface AppSidebarProps {
  view: View;
  onNavigate: (view: View) => void;
  onOpenCommandPalette: () => void;
  workspace: WorkspaceSnapshot | null;
  canEdit: boolean;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  machines: MachineConnection[];
  selectedMachineId: string;
  onSelectMachine: (id: string) => void;
  onAddMachine: (machine: MachineConnection) => void;
  auth: SignedInAuth;
  onSignOut: () => void;
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-[216px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <MachineSwitcher
        machines={props.machines}
        selectedId={props.selectedMachineId}
        onSelect={props.onSelectMachine}
        onAdd={props.onAddMachine}
      />
      <div className="px-2 py-2">
        <button
          type="button"
          onClick={props.onOpenCommandPalette}
          className="flex h-8 w-full items-center gap-2 rounded-md border bg-background/60 px-2 text-xs text-muted-foreground hover:bg-background"
        >
          <Search className="size-3.5" />
          Search or jump to…
        </button>
      </div>
      <ul className="space-y-1 px-2">
        {PRIMARY_NAV.map((item) => (
          <li key={item.view}>
            <button
              type="button"
              onClick={() => props.onNavigate(item.view)}
              aria-current={props.view === item.view ? "page" : undefined}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-sidebar-accent",
                props.view === item.view && "bg-sidebar-accent font-medium",
              )}
            >
              <item.icon className="size-4" />
              {item.label}
              {item.view === "projects" && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {props.workspace?.projects.length ?? 0}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-center justify-between px-4 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        Projects
        <button
          type="button"
          aria-label="Add project"
          disabled={!props.canEdit}
          onClick={props.onAddProject}
          className="rounded p-1 hover:bg-sidebar-accent disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <ul className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
        {props.workspace?.projects.map((project) => (
          <li key={project.id}>
            <button
              type="button"
              disabled={!props.canEdit}
              title={project.directory}
              onClick={() => props.onSelectProject(project.id)}
              aria-current={
                props.view === "projects" && props.workspace?.selection?.projectId === project.id
                  ? "page"
                  : undefined
              }
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-sidebar-accent disabled:opacity-50",
                props.view === "projects" &&
                  props.workspace?.selection?.projectId === project.id &&
                  "bg-sidebar-accent",
              )}
            >
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{project.name}</span>
            </button>
          </li>
        ))}
        {props.workspace?.projects.length === 0 && (
          <li className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            Add a project to organize your tabs and panes.
          </li>
        )}
      </ul>
      <div className="space-y-1 border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={() => props.onNavigate("settings")}
          aria-current={props.view === "settings" ? "page" : undefined}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] hover:bg-sidebar-accent",
            props.view === "settings" && "bg-sidebar-accent font-medium",
          )}
        >
          <Settings className="size-4" />
          Settings
        </button>
        <AccountMenu
          auth={props.auth}
          onSignOut={props.onSignOut}
          onOpenSettings={() => props.onNavigate("settings")}
        />
      </div>
    </nav>
  );
}
