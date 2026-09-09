import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ArrowLeft } from "lucide-react";
import type { WorkspaceProject, WorkspaceSnapshot } from "@concors/protocol";
import { FilesProvider, ProjectFileLinks } from "@/files/provider";
import { FilePromptsContext } from "@/files/prompts";
import { fileScope, useFiles } from "@/files/context";
import { FileTree } from "@/files/tree";
import { FileTab, FileTabLabel } from "@/files/file-tab";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { guardMobileLeave, hostAction } from "./bridge";

export function MobileFilesProvider({
  children,
  direct,
}: {
  children: ReactNode;
  direct: boolean;
}) {
  const beforeLeave = useRef<(() => boolean | Promise<boolean>) | null>(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const [prompt, setPrompt] = useState<{ message: string; confirm: boolean } | null>(null);
  const prompts = useMemo(() => {
    const ask = (message: string, confirm: boolean) =>
      new Promise<boolean>((resolve) => {
        if (pending.current) {
          resolve(false);
          return;
        }
        pending.current = resolve;
        setPrompt({ message, confirm });
      });
    return {
      confirm: (message: string) => ask(message, true),
      notify: (message: string) => {
        void ask(message, false);
      },
    };
  }, []);
  useEffect(() => guardMobileLeave(() => beforeLeave.current?.() ?? true), []);
  useEffect(
    () => () => {
      pending.current?.(false);
      pending.current = null;
    },
    [],
  );
  const answer = (value: boolean) => {
    pending.current?.(value);
    pending.current = null;
    setPrompt(null);
  };
  return (
    <FilePromptsContext value={prompts}>
      <FilesProvider beforeLeaveRef={beforeLeave} leaveLabel={direct ? "disconnect" : "sign out"}>
        <FileDraftGuard />
        {children}
      </FilesProvider>
      <Dialog
        open={!!prompt}
        onOpenChange={(open) => {
          if (!open) answer(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{prompt?.confirm ? "Unsaved file changes" : "Project files"}</DialogTitle>
            <DialogDescription>{prompt?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {prompt?.confirm && (
              <Button variant="outline" onClick={() => answer(false)}>
                Cancel
              </Button>
            )}
            <Button
              variant={prompt?.confirm ? "destructive" : "default"}
              onClick={() => answer(true)}
            >
              {prompt?.confirm ? "Continue" : "OK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FilePromptsContext>
  );
}
function FileDraftGuard() {
  const { files } = useFiles();
  const subscribe = useCallback(
    (listener: () => void) => {
      const off = files.map((file) => file.document.subscribe(listener));
      return () => off.forEach((unsubscribe) => unsubscribe());
    },
    [files],
  );
  const snapshot = useCallback(
    () => files.some((file) => file.document.dirty || file.document.getSnapshot().busy),
    [files],
  );
  const active = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => {
    void hostAction({ kind: "file-guard", active }).catch(() => undefined);
  }, [active]);
  return null;
}

/** Full-page mobile presentation; tree, documents, editor and conflict handling are desktop code. */
export function MobileFiles({
  project,
  workspace,
  available,
  connected,
  demo,
  offset,
  dragging,
}: {
  project: WorkspaceProject | null;
  workspace: WorkspaceSnapshot | null;
  available: boolean;
  connected: boolean;
  demo: boolean;
  offset: number;
  dragging: boolean;
}) {
  const files = useFiles();
  const open = files.sidebar.open;
  const scope =
    project && workspace ? fileScope(workspace.machineId, workspace.epoch, project.id) : "";
  const documents = files.files.filter((file) => file.scope === scope);
  const active = documents.find((file) => file.id === files.active[scope]);
  const navigation = active ? `${active.id}:${active.navigation}` : "directory";
  const [directoryFor, setDirectoryFor] = useState<string | null>(null);
  const browsing = !active || directoryFor === navigation;
  const [visited, setVisited] = useState(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) {
      // Opening a file browser must not summon the phone keyboard.
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisited(true);
    }
  }, [open]);
  const close = () => {
    files.sidebar.setOpen(false);
    requestAnimationFrame(() =>
      document.getElementById("mobile-files-toggle")?.focus({ preventScroll: true }),
    );
  };
  return (
    <section
      ref={panel}
      id="mobile-project-files"
      aria-label="Project files"
      aria-hidden={!open}
      inert={!open}
      className="mobile-files"
      data-open={open}
      style={{
        transform: `translateX(calc(100% - ${offset}px))`,
        transition: dragging ? "none" : undefined,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <header className="mobile-files-header">
        <button className="mobile-icon mobile-glass" aria-label="Back to chat" onClick={close}>
          <ArrowLeft />
        </button>
        <h1 className="mobile-files-location">
          <button
            className="mobile-files-directory mobile-glass"
            aria-label="Browse project directory"
            aria-current={browsing ? "page" : undefined}
            title={project?.directory}
            onClick={() => setDirectoryFor(navigation)}
          >
            <span>Files</span>
            <span>{project?.name ?? "Choose a project"}</span>
          </button>
        </h1>
      </header>
      {documents.length > 0 && (
        <nav
          aria-label="Open files"
          className="mobile-file-tabs"
          onClick={() => setDirectoryFor(null)}
        >
          {documents.map((file) => (
            <FileTabLabel key={file.id} file={file} />
          ))}
        </nav>
      )}
      {project && workspace && (visited || open) ? (
        <ProjectFileLinks project={project}>
          <div className="mobile-files-content">
            <div hidden={!browsing} className="mobile-files-tree">
              {available ? (
                <FileTree key={scope} project={project} open={open && browsing} onClose={close} />
              ) : (
                <div role="status" className="space-y-2 p-5 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {demo
                      ? "Connect a machine to browse files"
                      : connected
                        ? "File access needs a newer daemon"
                        : "Waiting for your machine"}
                  </p>
                  <p>
                    {demo
                      ? "The demo has no filesystem. Connect to a desktop daemon with project file support to browse and edit real files."
                      : connected
                        ? "This daemon does not support project files. Connect to an updated desktop daemon to browse and edit this directory. Updating the mobile app alone does not enable file access."
                        : "File browsing will resume when the desktop daemon reconnects."}
                  </p>
                  {documents.length > 0 && <p>Your open files and unsaved drafts are kept.</p>}
                </div>
              )}
            </div>
            {active && (
              <div hidden={browsing} className="mobile-files-editor">
                <FileTab key={active.id} file={active} />
              </div>
            )}
          </div>
        </ProjectFileLinks>
      ) : (
        <p className="p-5 text-sm text-muted-foreground">Open a project to browse its directory.</p>
      )}
    </section>
  );
}
