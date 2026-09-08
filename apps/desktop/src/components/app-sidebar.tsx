import { shortcutLabel } from "@/shortcuts/bindings";
import { AgentSidebar } from "@/agents/list";
import { ProjectActions } from "@/workspace/project-actions";
import { SidebarSection } from "./sidebar-section";
import { Folder, PanelLeftClose, Plus, Search } from "lucide-react";
import { cn } from "cn";
import type { WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import type { View } from "@/navigation";
import type { SignedInAuth } from "@/auth/auth-state";
import { AccountMenu } from "@/components/account-menu";
import { MachineSwitcher } from "@/workspace/machine-switcher";
import type { MachineConnection } from "@/workspace/machines";

interface AppSidebarProps {
  collapsed: boolean;
  onCollapse: () => void;
  onSelectAgent: (id: string) => void;
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
  execute: (operation: WorkspaceOperation) => Promise<void>;
}

export function AppSidebar(props: AppSidebarProps) {
  return (
    <div
      className="sidebar-shell"
      data-collapsed={props.collapsed}
      inert={props.collapsed}
      aria-hidden={props.collapsed ? true : undefined}
    >
      <nav
        id="app-sidebar"
        aria-label="Primary"
        className="flex h-full w-[216px] flex-col bg-sidebar text-[13px] text-sidebar-foreground"
      >
        <div className="m-2 flex h-9 items-center justify-between gap-1">
          <MachineSwitcher
            machines={props.machines}
            selectedId={props.selectedMachineId}
            onSelect={props.onSelectMachine}
            onAdd={props.onAddMachine}
          />
          <button
            id="collapse-sidebar"
            type="button"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            aria-controls="app-sidebar"
            aria-expanded={true}
            onClick={props.onCollapse}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <PanelLeftClose className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="px-2 py-2">
          <button
            type="button"
            title={`Search (${shortcutLabel("search")})`}
            onClick={props.onOpenCommandPalette}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground hover:bg-sidebar-accent"
          >
            <Search className="size-4" />
            Search or jump to…
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
          <SidebarSection
            title="Projects"
            action={
              <button
                type="button"
                aria-label="Add project"
                disabled={!props.canEdit}
                onClick={props.onAddProject}
                className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            }
          >
            <ul className="mt-1 space-y-0.5">
              {props.workspace?.projects.map((project) => (
                <li key={project.id} className="group flex items-center">
                  <button
                    type="button"
                    disabled={!props.canEdit}
                    title={project.directory}
                    onClick={() => props.onSelectProject(project.id)}
                    aria-current={
                      props.view === "projects" &&
                      props.workspace?.selection?.projectId === project.id
                        ? "page"
                        : undefined
                    }
                    className={cn(
                      "flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-sidebar-accent disabled:opacity-50",
                      props.view === "projects" &&
                        props.workspace?.selection?.projectId === project.id &&
                        "bg-sidebar-accent",
                    )}
                  >
                    <Folder className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{project.name}</span>
                  </button>
                  <ProjectActions
                    project={project}
                    canEdit={props.canEdit}
                    execute={props.execute}
                  />
                </li>
              ))}
              {props.workspace?.projects.length === 0 && (
                <li className="px-2 py-3 text-[13px] leading-relaxed text-muted-foreground">
                  Add a project to organize your tabs and panes.
                </li>
              )}
            </ul>
          </SidebarSection>
          <SidebarSection title="Agents">
            <AgentSidebar onSelect={props.onSelectAgent} workspace={props.workspace} />
          </SidebarSection>
          <SidebarSection title="Servers">
            <p className="px-2 py-2 leading-relaxed text-muted-foreground">
              No servers discovered.
            </p>
          </SidebarSection>
        </div>
        <div className="space-y-1 border-t border-sidebar-border p-2">
          <AccountMenu
            auth={props.auth}
            onSignOut={props.onSignOut}
            onOpenSettings={() => props.onNavigate("settings")}
          />
        </div>
      </nav>
    </div>
  );
}
