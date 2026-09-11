import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, LoaderCircle, Pencil, Plus, RefreshCw } from "lucide-react";
import {
  ProviderConfigSchema,
  type ProviderOperation,
  type ProviderStatus,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ProviderIcon } from "@/agents/provider-icon";

export function ProvidersSettings() {
  const connection = useContext(TerminalConnectionContext);
  const [state, setState] = useState(connection?.state);
  const [data, setData] = useState<{ revision: number; providers: ProviderStatus[] } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ProviderStatus | "new" | null>(null);
  const mounted = useRef(true);
  const supported =
    state?.status === "ready" && state.daemon.capabilities?.includes("provider-settings");
  const request = useCallback(
    async (operation: ProviderOperation, active: () => boolean = () => true) => {
      if (!connection) throw new Error("Reconnect to the machine first.");
      const result = await connection.requestProvider(operation, crypto.randomUUID());
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (mounted.current && active()) {
        setData(result.outcome);
        if (operation.kind === "list") setRefreshError(null);
      }
    },
    [connection],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [connection]);
  useEffect(() => connection?.subscribe(setState), [connection]);
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    const refresh = () => {
      void request({ kind: "list" }, () => !cancelled).catch((e: Error) => {
        if (!cancelled) setRefreshError(e.message);
      });
    };
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, supported, request]); // Poll also observes installs started from another client.
  const execute = async (operation: ProviderOperation) => {
    setBusy(true);
    setError(null);
    try {
      await request(operation);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not update providers";
      if (operation.kind === "list") setRefreshError(message);
      else setError(message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const visibleError = error ?? refreshError;
  return (
    <section aria-label="Agent providers">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Agent providers</h2>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Check provider installations"
            disabled={!supported || busy}
            onClick={() =>
              void execute({ kind: "list" }).catch(() => {
                /* The operation already displayed its error. */
              })
            }
          >
            <RefreshCw />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!supported}
            onClick={() => setEditing("new")}
          >
            <Plus /> Add provider
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Run your own agent CLIs and accounts. Installations and settings belong to the connected
        machine and work from desktop or mobile.
      </p>
      {!supported && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Connect to a machine with provider settings support. Update its daemon if this page is
          unavailable.
        </p>
      )}
      {visibleError && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {visibleError}
        </p>
      )}
      {supported && (
        <>
          <Input
            className="mt-5"
            aria-label="Search providers"
            placeholder="Search providers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="mt-4 divide-y rounded-lg border">
            {data?.providers
              .filter((p) => `${p.label} ${p.engine}`.toLowerCase().includes(search.toLowerCase()))
              .map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                  <ProviderIcon provider={p.id} />
                  <div className="min-w-0 flex-1 basis-32">
                    <p className="font-medium">{p.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.installStatus === "installing"
                        ? "Installing on this machine…"
                        : !p.installed
                          ? "Not installed"
                          : p.enabled
                            ? "Installed · Enabled"
                            : "Installed · Disabled"}
                      {p.engine === "acp" ? " · ACP" : ""}
                    </p>
                    {p.error && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {p.error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!p.installed && p.canInstall && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || p.installStatus === "installing"}
                        onClick={() =>
                          void execute({ kind: "install", id: p.id }).catch(() => {
                            /* The operation already displayed its error. */
                          })
                        }
                      >
                        {p.installStatus === "installing" ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Download />
                        )}{" "}
                        Install
                      </Button>
                    )}
                    {p.installLink && (
                      <a
                        href={p.installLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex size-8 items-center justify-center rounded hover:bg-muted"
                        aria-label={`${p.label} installation and sign-in guide`}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Configure ${p.label}`}
                      disabled={p.installStatus === "installing"}
                      onClick={() => setEditing(p)}
                    >
                      <Pencil />
                    </Button>
                  </div>
                </div>
              ))}
            {!data && (
              <p role="status" className="p-4 text-sm text-muted-foreground">
                Checking installed providers…
              </p>
            )}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Installed doesn’t mean signed in. Open the provider’s CLI on this machine to connect
            your account. ACP controls and available models depend on the provider.
          </p>
        </>
      )}
      {editing && data && (
        <ProviderEditor
          key={editing === "new" ? "new" : editing.id}
          provider={editing === "new" ? null : editing}
          revision={data.revision}
          onSave={execute}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function ProviderEditor({
  provider,
  revision,
  onSave,
  onClose,
}: {
  provider: ProviderStatus | null;
  revision: number;
  onSave: (op: ProviderOperation) => Promise<void>;
  onClose: () => void;
}) {
  const [id] = useState(provider?.id ?? `custom-${crypto.randomUUID()}`);
  const [label, setLabel] = useState(provider?.label ?? ""),
    [engine, setEngine] = useState(provider?.engine ?? "acp");
  const [command, setCommand] = useState(provider?.command[0] ?? ""),
    [args, setArgs] = useState(provider?.command.slice(1).join("\n") ?? "");
  const [models, setModels] = useState(provider?.models?.join("\n") ?? ""),
    [enabled, setEnabled] = useState(provider?.enabled ?? true);
  const [envKey, setEnvKey] = useState(""),
    [envValue, setEnvValue] = useState("");
  const [mcp, setMcp] = useState("");
  const [removeEnv, setRemoveEnv] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const initialRevision = useRef(revision);
  const submit = async () => {
    setError(null);
    let mcpServers: unknown;
    try {
      if (mcp.trim()) mcpServers = JSON.parse(mcp);
    } catch {
      setError("MCP servers must be a JSON array.");
      return;
    }
    const parsed = ProviderConfigSchema.safeParse({
      id,
      label,
      engine,
      command: [command, ...(args ? args.split("\n") : [])],
      enabled,
      models: models
        .split("\n")
        .map((m) => m.trim())
        .filter(Boolean),
      params: { ...provider?.params, ...(mcpServers === undefined ? {} : { mcpServers }) },
      ...(envKey ? { env: { [envKey]: envValue } } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the provider fields");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        kind: "save",
        config: parsed.data,
        removeEnv,
        expectedRevision: initialRevision.current,
      });
      setEnvValue("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {provider ? `Configure ${provider.label}` : "Add an agent provider"}
          </DialogTitle>
          <DialogDescription>
            These settings launch a CLI on your machine. New settings apply to new or reconnected
            sessions.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1 text-sm">
            Name
            <Input value={label} onChange={(e) => setLabel(e.target.value)} required />
          </label>
          <label className="block space-y-1 text-sm">
            Protocol
            <select
              className="h-9 w-full rounded border bg-background px-3"
              value={engine}
              onChange={(e) => setEngine(e.target.value as typeof engine)}
            >
              {["acp", "codex", "claude", "opencode", "pi", "omp"].map((e) => (
                <option key={e} value={e}>
                  {e === "acp" ? "Agent Client Protocol (ACP)" : e}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            Executable
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="agent-cli or /path/to/agent"
              required
            />
          </label>
          <label className="block space-y-1 text-sm">
            Arguments · one per line
            <Textarea
              className="font-mono text-sm"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="--acp"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Enable in the agent picker
          </label>
          <details>
            <summary className="cursor-pointer text-sm">Credentials and model filter</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Credential values stay on the machine. Existing values are preserved unless replaced
                or removed.
              </p>
              {provider?.envKeys.map((key) => (
                <label key={key} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={removeEnv.includes(key)}
                    onChange={(e) =>
                      setRemoveEnv((old) =>
                        e.target.checked ? [...old, key] : old.filter((k) => k !== key),
                      )
                    }
                  />{" "}
                  Remove {key}
                </label>
              ))}
              <label className="block space-y-1 text-sm">
                Environment variable
                <Input
                  value={envKey}
                  onChange={(e) => setEnvKey(e.target.value)}
                  placeholder="PROVIDER_API_KEY"
                  autoComplete="off"
                />
              </label>
              <label className="block space-y-1 text-sm">
                New value
                <Input
                  type="password"
                  value={envValue}
                  onChange={(e) => setEnvValue(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="block space-y-1 text-sm">
                Model IDs · one per line
                <Textarea
                  className="font-mono text-sm"
                  value={models}
                  onChange={(e) => setModels(e.target.value)}
                  placeholder="Leave blank to show the provider’s full catalog"
                />
              </label>
            </div>
          </details>
          {!["pi", "omp"].includes(engine) && provider?.params?.supportsMcpServers !== false && (
            <details>
              <summary className="cursor-pointer text-sm">MCP servers</summary>
              <p className="mt-3 text-xs text-muted-foreground">
                {provider?.mcpServerNames?.length
                  ? `Configured: ${provider.mcpServerNames.join(", ")}. `
                  : ""}
                Leave blank to keep the current servers. Enter [] to remove these overrides. The
                agent also loads its own MCP configuration.
              </p>
              <label className="mt-3 block space-y-1 text-sm">
                Replace MCP configuration
                <Textarea
                  aria-label="MCP server configuration"
                  className="min-h-28 font-mono text-xs"
                  value={mcp}
                  onChange={(e) => setMcp(e.target.value)}
                  spellCheck={false}
                  placeholder={'[{"name":"docs","type":"http","url":"https://example.com/mcp"}]'}
                />
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                HTTP/SSE: name, type, url, optional headers. Stdio: name, type, command, args,
                optional env. Credential values stay on the machine.
              </p>
            </details>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy}>{busy ? "Saving…" : "Save provider"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
