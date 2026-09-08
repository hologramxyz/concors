import { useContext, useEffect, useState } from "react";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { ProjectImage } from "@/workspace/project-image";
import { repositoryImage } from "@/workspace/repository-image";
import type { ProjectSetup } from "@concors/protocol";
import { shortcutLabel } from "@/shortcuts/bindings";
import { AgentSidebar } from "@/agents/list";
import { ProjectActions } from "@/workspace/project-actions";
import { SidebarSection } from "./sidebar-section";
import { Keyboard, PanelLeftClose, Plus, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  onOpenShortcuts: () => void;
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
  const connection = useContext(TerminalConnectionContext);
  const [setupState, setSetupState] = useState<{
    connection: typeof connection;
    setups: ProjectSetup[];
  }>({ connection: null, setups: [] });
  useEffect(() => {
    return connection?.subscribeProjectSetups((setups) => setSetupState({ connection, setups }));
  }, [connection]);
  const images = new Map(
    (setupState.connection === connection ? setupState.setups : [])
      .filter((setup) => setup.mode === "clone" && setup.status === "done")
      .map((setup) => [setup.id, repositoryImage(setup.repository)]),
  );

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
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Search"
                  onClick={props.onOpenCommandPalette}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                >
                  <Search className="size-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Search ({shortcutLabel("search")})</TooltipContent>
            </Tooltip>
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
                className="rounded p-1 text-muted-foreground hover:text-sidebar-foreground disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            }
          >
            <ul className="mt-1 space-y-0.5">
              {props.workspace?.projects.map((project) => (
                <li
                  key={project.id}
                  className={cn(
                    "group flex items-center rounded-md focus-within:bg-sidebar-accent hover:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent",
                    props.view === "projects" &&
                      props.workspace?.selection?.projectId === project.id &&
                      "bg-sidebar-accent",
                  )}
                >
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
                    className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-[13px] disabled:opacity-50"
                  >
                    <ProjectImage
                      key={images.get(project.id) ?? "folder"}
                      source={images.get(project.id) ?? null}
                    />
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
        <div className="flex items-center gap-1 border-t border-sidebar-border p-2">
          <div className="min-w-0 flex-1">
            <AccountMenu
              auth={props.auth}
              onSignOut={props.onSignOut}
              onOpenSettings={() => props.onNavigate("settings")}
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Keyboard shortcuts"
                onClick={props.onOpenShortcuts}
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Keyboard className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="flex items-center gap-2 text-sm">
              Keyboard shortcuts <kbd>{shortcutLabel("shortcuts")}</kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </div>
  );
}
