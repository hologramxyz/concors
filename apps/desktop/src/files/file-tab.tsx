import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { FileCode2, RefreshCw, Save, WrapText } from "lucide-react";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { AgentMarkdown, CopyButton } from "@/agents/markdown";
import { Button } from "@/components/ui/button";
import type { FileOperation } from "@concors/protocol";
import { useFiles, type OpenFile } from "./context";
const CodeEditor = lazy(() => import("./code-editor"));

export function FileTabLabel({ file }: { file: OpenFile }) {
  const state = useSyncExternalStore(file.document.subscribe, file.document.getSnapshot);
  const files = useFiles();
  const dirty = state.base !== null && state.content !== state.base.content;
  return (
    <div
      className={`group flex shrink-0 items-center rounded-md border ${files.active[file.scope] === file.id ? "border-border bg-background shadow-xs" : "border-transparent"}`}
    >
      <button
        type="button"
        title={file.path}
        aria-pressed={files.active[file.scope] === file.id}
        onClick={() => files.select(file.scope, file.id)}
        className="flex max-w-52 items-center gap-1.5 px-2 py-1 text-xs"
      >
        <FileCode2 className="size-3.5 shrink-0" />
        <span className="truncate">{file.path.split("/").pop()}</span>
        {dirty && <span aria-label="Unsaved changes">●</span>}
      </button>
      <button
        type="button"
        disabled={state.busy}
        aria-label={`Close ${file.path} file`}
        onClick={() => files.close(file)}
        className="px-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        ×
      </button>
    </div>
  );
}
export function FileTab({ file }: { file: OpenFile }) {
  const connection = useContext(TerminalConnectionContext);
  const state = useSyncExternalStore(file.document.subscribe, file.document.getSnapshot);
  const [mode, setMode] = useState({
    preview: /\.(md|markdown)$/i.test(file.path) && !file.location.line,
    navigation: file.navigation,
  });
  const preview = file.location.line && mode.navigation !== file.navigation ? false : mode.preview;
  const [compare, setCompare] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [vimEnabled, setVim] = useState(() => {
    try {
      return localStorage.getItem("concors.files.vim") === "true";
    } catch {
      return false;
    }
  });
  const available =
    connection?.state.status === "ready" &&
    connection.workspace?.epoch === file.document.target.epoch &&
    connection.workspace.projects.some((project) => project.id === file.projectId) &&
    !!connection.state.daemon.capabilities?.includes("project-files");
  const request = useCallback(
    async (operation: FileOperation) => {
      if (!connection || !available)
        throw new Error("Reconnect to this machine before saving. Your draft is kept.");
      return (await connection.requestFile(operation, crypto.randomUUID())).outcome;
    },
    [connection, available],
  );
  useEffect(() => {
    if (!available) return;
    if (!file.document.getSnapshot().base) void file.document.load(request);
    else void file.document.check(request);
    let checking = false;
    const check = () => {
      if (document.hidden || checking) return;
      checking = true;
      void file.document.check(request).finally(() => {
        checking = false;
      });
    };
    const timer = setInterval(check, 5000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [file.document, available, request]);
  const dirty = state.base !== null && state.content !== state.base.content;
  const save = () => {
    if (available) void file.document.save(request);
  };
  return (
    <section
      aria-label={`File ${file.path}`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-t"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        <span
          title={file.path}
          className="min-w-20 flex-1 truncate font-mono text-xs text-muted-foreground"
        >
          {file.path}
        </span>
        {/\.(md|markdown)$/i.test(file.path) && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setMode({ preview: !preview, navigation: file.navigation })}
          >
            {preview ? "Edit source" : "Preview"}
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          aria-pressed={vimEnabled}
          onClick={() => {
            const next = !vimEnabled;
            setVim(next);
            try {
              localStorage.setItem("concors.files.vim", String(next));
            } catch {
              /* The toggle still works when browser storage is unavailable. */
            }
          }}
        >
          Vim
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Toggle word wrap"
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          <WrapText />
        </Button>
        <CopyButton text={state.content} label="Copy file" />
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Reload file from disk"
          disabled={!available || state.busy}
          onClick={() => {
            if (!dirty || window.confirm("Discard your draft and reload this file from disk?"))
              void file.document.load(request, true);
          }}
        >
          <RefreshCw />
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={!available || state.busy || !dirty || state.changed}
          onClick={save}
        >
          <Save />
          {state.busy ? "Working…" : "Save"}
        </Button>
      </div>
      {!available && (
        <p role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">
          Disconnected. Your draft is kept; reconnect to save.
        </p>
      )}
      {state.error && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state.changed && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs"
        >
          <span className="flex-1">This file changed on the machine. Your version is kept.</span>
          <Button
            size="xs"
            variant="outline"
            disabled={!available || state.busy}
            onClick={() => {
              setCompare(!compare);
              if (!compare) void file.document.check(request);
            }}
          >
            {compare ? "Hide disk version" : "Compare with disk"}
          </Button>
        </div>
      )}
      {compare && state.disk && (
        <div className="flex max-h-[45%] min-h-0 flex-col border-b bg-muted/20">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
            <span className="flex-1">Latest version on disk</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                if (!dirty || window.confirm("Discard your draft and use the disk version?")) {
                  void file.document.load(request, true);
                  setCompare(false);
                }
              }}
            >
              Use disk version
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={state.busy || !available}
              onClick={() => {
                if (
                  window.confirm(
                    "Use your draft in place of the disk version shown? You still need to Save.",
                  )
                ) {
                  file.document.keepDraftOnLatest();
                  setCompare(false);
                }
              }}
            >
              Keep my draft
            </Button>
          </div>
          <pre className="min-h-0 overflow-auto px-3 pb-3 font-mono text-xs">
            {state.disk.content}
          </pre>
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {state.base ? (
          preview ? (
            <div className="h-full overflow-auto p-5">
              <AgentMarkdown sourcePath={file.path}>{state.content}</AgentMarkdown>
            </div>
          ) : (
            <Suspense fallback={<p className="p-4 text-sm">Loading editor…</p>}>
              <CodeEditor
                content={state.content}
                path={file.path}
                onChange={file.document.edit}
                onSave={save}
                vimEnabled={vimEnabled}
                wrap={wrap}
                location={file.location}
                navigation={file.navigation}
              />
            </Suspense>
          )
        ) : (
          <p role="status" className="p-4 text-sm text-muted-foreground">
            {state.busy
              ? "Reading file…"
              : state.error
                ? "Choose another file or retry with Reload."
                : "Waiting for the machine…"}
          </p>
        )}
      </div>
      <div className="shrink-0 border-t px-3 py-1 font-mono text-[10px] text-muted-foreground">
        {dirty ? "Unsaved changes" : state.base ? "Saved on machine" : "File preview"} ·{" "}
        {vimEnabled ? "Vim · :w to save" : "⌘/Ctrl+S to save"}
      </div>
    </section>
  );
}
