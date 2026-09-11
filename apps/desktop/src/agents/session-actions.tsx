import { useContext, useState } from "react";
import { Dialog } from "radix-ui";
import { GitFork, History, Undo2, X } from "lucide-react";
import type { AgentInfo, AgentItem, AgentOperation, NativeSession } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

export function SessionActions({
  agent,
  items,
  connected,
}: {
  agent: AgentInfo;
  items: AgentItem[];
  connected: boolean;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [page, setPage] = useState<"import" | "rewind" | "mcp" | null>(null),
    [sessions, setSessions] = useState<NativeSession[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [servers, setServers] = useState<{ name: string; status: string }[]>([]);
  const [turn, setTurn] = useState(""),
    [mode, setMode] = useState<"files" | "conversation" | "both">("conversation");
  const idle = !["starting", "working", "needs_input"].includes(agent.status);
  const controls = agent.controls;
  if (
    !controls ||
    (!controls.importSessions && !controls.fork && !controls.rewind.length && !controls.mcpStatus)
  )
    return null;
  const perform = async (op: AgentOperation) => {
    if (!connection) throw new Error("Machine is disconnected");
    const result = await connection.requestAgent(op, crypto.randomUUID());
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    return result.outcome;
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update session");
    } finally {
      setBusy(false);
    }
  };
  const action =
    "flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40";
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {controls.importSessions && (
          <button
            type="button"
            className={action}
            disabled={!connected || busy}
            onClick={() => {
              setPage("import");
              void run(async () => {
                const result = await perform({ kind: "sessions-list", sessionId: agent.id });
                setSessions(result.sessions ?? []);
              });
            }}
          >
            <History className="size-3.5" />
            Import session
          </button>
        )}
        {controls.fork && (
          <button
            type="button"
            className={action}
            disabled={!connected || busy || !idle}
            onClick={() =>
              void run(async () => {
                await perform({
                  kind: "fork-session",
                  sessionId: agent.id,
                  expectedRevision: agent.revision,
                });
              })
            }
          >
            <GitFork className="size-3.5" />
            Fork session
          </button>
        )}
        {!!controls.rewind.length && (
          <button
            type="button"
            className={action}
            disabled={!connected || busy || !idle || !items.some((i) => i.kind === "user")}
            onClick={() => {
              setMode(controls.rewind[0] ?? "conversation");
              setTurn("");
              setError(null);
              setPage("rewind");
            }}
          >
            <Undo2 className="size-3.5" />
            Rewind
          </button>
        )}
        {controls.mcpStatus && (
          <button
            type="button"
            className={action}
            disabled={!connected || busy}
            onClick={() => {
              setPage("mcp");
              void run(async () => {
                const result = await perform({ kind: "mcp-status", sessionId: agent.id });
                setServers(result.servers ?? []);
              });
            }}
          >
            MCP servers
          </button>
        )}
      </div>
      {error && !page && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog.Root
        open={page !== null}
        onOpenChange={(open) => {
          if (!open) setPage(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[80dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-medium">
                {page === "import"
                  ? "Import an agent session"
                  : page === "mcp"
                    ? "MCP servers"
                    : "Rewind this session"}
              </Dialog.Title>
              <Dialog.Close aria-label="Close" className="rounded p-1 hover:bg-muted">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-sm text-muted-foreground">
              {page === "mcp"
                ? "Status reported by your agent. Configure servers in Settings → Providers or in the CLI’s own configuration."
                : page === "import"
                  ? "Open a session from this agent’s CLI in a new Concors tab. No prompt is sent."
                  : mode === "files"
                    ? "Restore files to a checkpoint before the selected message. Later file edits can be overwritten; conversation history stays."
                    : mode === "both"
                      ? "Remove the selected turn and later messages, and undo their file changes. Queued work will pause."
                      : "Remove the selected turn and later messages from this conversation. Files stay as they are. Queued work will pause."}
            </Dialog.Description>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {page === "mcp" ? (
              <div className="space-y-3 overflow-y-auto text-sm">
                {busy
                  ? "Checking servers…"
                  : servers.length
                    ? servers.map((s) => (
                        <div key={s.name} className="flex justify-between gap-4">
                          <span>{s.name}</span>
                          <span className="text-muted-foreground">
                            {s.status.replaceAll("_", " ")}
                          </span>
                        </div>
                      ))
                    : "No MCP servers reported by this agent."}
              </div>
            ) : page === "import" ? (
              <div className="min-h-0 overflow-y-auto">
                {busy ? (
                  <p className="text-sm text-muted-foreground">Reading native sessions…</p>
                ) : sessions.filter((s) => s.id !== agent.threadId).length ? (
                  sessions
                    .filter((s) => s.id !== agent.threadId)
                    .map((s) => (
                      <button
                        key={s.id}
                        className="block w-full rounded px-3 py-3 text-left hover:bg-muted disabled:opacity-50"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await perform({
                              kind: "import-session",
                              sessionId: agent.id,
                              nativeSessionId: s.id,
                              expectedRevision: agent.revision,
                            });
                            setPage(null);
                          })
                        }
                      >
                        <span className="line-clamp-2 text-sm">{s.title || "Agent session"}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(s.updatedAt).toLocaleString()}
                        </span>
                      </button>
                    ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No other native sessions in this project.
                  </p>
                )}
              </div>
            ) : (
              <>
                {controls.rewind.length > 1 && (
                  <select
                    aria-label="Rewind scope"
                    className="rounded border bg-background p-2 text-sm"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as typeof mode)}
                  >
                    {controls.rewind.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  aria-label="Rewind before message"
                  className="min-w-0 rounded border bg-background p-2 text-sm"
                  value={turn}
                  onChange={(e) => setTurn(e.target.value)}
                >
                  <option value="">Before which message?</option>
                  {items
                    .filter((i) => i.kind === "user" && !i.id.startsWith("steer:"))
                    .map((i) => (
                      <option key={i.id} value={i.turnId}>
                        {i.text.slice(0, 100)}
                      </option>
                    ))}
                </select>
                <button
                  className="rounded bg-foreground px-3 py-2 text-sm text-background disabled:opacity-40"
                  disabled={!turn || busy || !idle}
                  onClick={() =>
                    void run(async () => {
                      await perform({
                        kind: "rewind",
                        sessionId: agent.id,
                        turnId: turn,
                        mode,
                        expectedRevision: agent.revision,
                      });
                      setPage(null);
                    })
                  }
                >
                  {busy ? "Rewinding…" : mode === "files" ? "Restore files" : "Rewind session"}
                </button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
