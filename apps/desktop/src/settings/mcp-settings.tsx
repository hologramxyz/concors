import { useContext, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  MACHINE_MCP_SERVERS_CAPABILITY,
  McpServerInputSchema,
  type McpServerInput,
  type McpServerSummary,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Section, SettingsCard } from "@/views/settings-primitives";
import { mcpServerInput, secretKeys } from "./mcp-servers";

/**
 * MCP servers for every agent on the connected machine. Secret values (env, headers) stay on the
 * machine: the page knows their names only, and a saved value left blank is kept.
 */
export function McpSettings() {
  const connection = useContext(TerminalConnectionContext);
  const [state, setState] = useState(connection?.state);
  const [servers, setServers] = useState<McpServerSummary[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<McpServerSummary | "new" | null>(null);
  useEffect(() => connection?.subscribe(setState), [connection]);
  const supported =
    state?.status === "ready" &&
    !!state.daemon.capabilities?.includes(MACHINE_MCP_SERVERS_CAPABILITY);
  useEffect(() => {
    if (!supported || !connection) return;
    let cancelled = false;
    connection.requestProvider({ kind: "list" }, crypto.randomUUID()).then(
      (result) => {
        if (cancelled) return;
        if (result.outcome.status === "error") setError(result.outcome.message);
        else {
          setServers(result.outcome.mcpServers ?? []);
          setRevision(result.outcome.revision);
        }
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not load MCP servers.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [supported, connection]);
  /** Saves the whole list; every server not being edited keeps its secrets by name. */
  const save = async (next: McpServerInput[]) => {
    if (!connection) throw new Error("Reconnect to the machine first.");
    const result = await connection.requestProvider(
      { kind: "mcp-save", servers: next, expectedRevision: revision },
      crypto.randomUUID(),
    );
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    setServers(result.outcome.mcpServers ?? []);
    setRevision(result.outcome.revision);
  };
  const others = (name: string | null) =>
    (servers ?? [])
      .filter((server) => server.name !== name)
      .map((server) => mcpServerInput(server));
  return (
    <Section
      title="MCP servers"
      description="Tools every agent on this machine can use: Claude Code, Codex, OpenCode and ACP agents. Each agent also keeps the MCP servers in its own configuration on the machine."
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={!supported || !servers || servers.length >= 32}
          onClick={() => setEditing("new")}
        >
          <Plus /> Add server
        </Button>
      }
    >
      {!supported ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state?.status === "ready"
            ? "Update this machine’s Concors service to manage MCP servers here."
            : "Connect to a machine to manage its MCP servers."}
        </p>
      ) : (
        <SettingsCard className="divide-y">
          {servers?.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">
              No MCP servers yet. Add one to give every agent on this machine its tools.
            </p>
          )}
          {servers?.map((server) => (
            <div key={server.name} className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {server.name}
                  <span className="rounded border px-1.5 text-xs font-normal text-muted-foreground">
                    {server.type === "stdio" ? "Command" : server.type.toUpperCase()}
                  </span>
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {server.type === "stdio"
                    ? [server.command, ...server.args].join(" ")
                    : server.url}
                </p>
                {secretKeys(server).length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Secrets saved on the machine: {secretKeys(server).join(", ")}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${server.name}`}
                onClick={() => setEditing(server)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${server.name}`}
                onClick={() => {
                  if (!window.confirm(`Remove the ${server.name} MCP server from this machine?`))
                    return;
                  setError(null);
                  void save(others(server.name)).catch((cause: Error) => setError(cause.message));
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          {!servers && (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Loading MCP servers…
            </p>
          )}
        </SettingsCard>
      )}
      {supported && (
        <p className="mt-4 text-sm text-muted-foreground">
          Agents load MCP servers when they start, so a change restarts idle agents; their
          conversations are kept. Pi manages MCP itself, and Codex uses HTTP and command servers but
          not SSE.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {editing && (
        <McpServerEditor
          server={editing === "new" ? null : editing}
          onSave={(input) =>
            save([...others(editing === "new" ? null : editing.name), input]).then(() =>
              setEditing(null),
            )
          }
          onClose={() => setEditing(null)}
        />
      )}
    </Section>
  );
}

interface SecretRow {
  key: string;
  value: string;
  /** Saved on the machine already; a blank value keeps it. */
  saved: boolean;
}

function McpServerEditor({
  server,
  onSave,
  onClose,
}: {
  server: McpServerSummary | null;
  onSave: (input: McpServerInput) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(server?.name ?? "");
  const [type, setType] = useState<McpServerSummary["type"]>(server?.type ?? "stdio");
  const [command, setCommand] = useState(server?.type === "stdio" ? server.command : "");
  const [args, setArgs] = useState(server?.type === "stdio" ? server.args.join("\n") : "");
  const [url, setUrl] = useState(server && server.type !== "stdio" ? server.url : "");
  const [secrets, setSecrets] = useState<SecretRow[]>(
    server ? secretKeys(server).map((key) => ({ key, value: "", saved: true })) : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const secretLabel = type === "stdio" ? "Environment variables" : "Headers";
  const submit = async () => {
    setError(null);
    const values = Object.fromEntries(
      secrets
        .filter((row) => row.key.trim())
        .map((row) => [row.key.trim(), row.saved && !row.value ? null : row.value]),
    );
    const parsed = McpServerInputSchema.safeParse(
      type === "stdio"
        ? {
            name: name.trim(),
            type,
            command: command.trim(),
            args: args.split("\n").filter((arg) => arg.trim()),
            env: values,
          }
        : { name: name.trim(), type, url: url.trim(), headers: values },
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.path[0] === "name"
          ? "Use letters, numbers, - and _ for the name."
          : issue?.path[0] === "url"
            ? "Enter the server's full URL, starting with https://."
            : (issue?.message ?? "Check the server's fields."),
      );
      return;
    }
    setBusy(true);
    try {
      await onSave(parsed.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the server.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{server ? `Edit ${server.name}` : "Add an MCP server"}</DialogTitle>
          <DialogDescription>
            Run a command on the machine, or connect to a server by URL.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="font-medium">Name</span>
            <Input
              aria-label="Name"
              value={name}
              // Saved secrets are kept by the server's name, so an existing server keeps it.
              disabled={!!server}
              placeholder="github"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1">
            <span className="font-medium">Type</span>
            <select
              aria-label="Type"
              className="h-9 rounded-md border bg-background px-2"
              value={type}
              onChange={(event) => {
                const next = event.target.value as McpServerSummary["type"];
                // Env variables and headers are different secrets; a switch starts afresh.
                if ((next === "stdio") !== (type === "stdio")) setSecrets([]);
                setType(next);
              }}
            >
              <option value="stdio">Command on the machine</option>
              <option value="http">URL (HTTP)</option>
              <option value="sse">URL (SSE)</option>
            </select>
          </label>
          {type === "stdio" ? (
            <>
              <label className="grid gap-1">
                <span className="font-medium">Command</span>
                <Input
                  aria-label="Command"
                  className="font-mono"
                  value={command}
                  placeholder="npx"
                  onChange={(event) => setCommand(event.target.value)}
                />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">Arguments, one per line</span>
                <Textarea
                  aria-label="Arguments"
                  className="min-h-16 font-mono text-xs"
                  value={args}
                  placeholder={"-y\n@modelcontextprotocol/server-github"}
                  onChange={(event) => setArgs(event.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="grid gap-1">
              <span className="font-medium">URL</span>
              <Input
                aria-label="URL"
                className="font-mono"
                value={url}
                placeholder="https://example.com/mcp"
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          )}
          <div className="grid gap-1.5">
            <span className="font-medium">{secretLabel}</span>
            {secrets.map((row, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  aria-label={`${secretLabel} name ${index + 1}`}
                  className="font-mono"
                  value={row.key}
                  disabled={row.saved}
                  placeholder={type === "stdio" ? "GITHUB_TOKEN" : "Authorization"}
                  onChange={(event) =>
                    setSecrets(
                      secrets.map((r, i) => (i === index ? { ...r, key: event.target.value } : r)),
                    )
                  }
                />
                <Input
                  aria-label={`${secretLabel} value ${index + 1}`}
                  type="password"
                  value={row.value}
                  placeholder={row.saved ? "Saved; leave blank to keep" : "Value"}
                  onChange={(event) =>
                    setSecrets(
                      secrets.map((r, i) =>
                        i === index ? { ...r, value: event.target.value } : r,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${row.key || "this entry"}`}
                  onClick={() => setSecrets(secrets.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => setSecrets([...secrets, { key: "", value: "", saved: false }])}
            >
              <Plus /> Add {type === "stdio" ? "a variable" : "a header"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Values are saved on the machine and never shown again.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
