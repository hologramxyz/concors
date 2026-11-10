import { useContext, useEffect, useState } from "react";
import { agentProviderName, type AgentInfo, type AgentOperation } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { openExternal } from "@/tauri/open-external";
import { mcpStatusLabel } from "./mcp-status";

const TONES = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
  muted: "text-muted-foreground",
} as const;

/** How often a sign-in in progress is checked, and for how long before the dialog stops asking. */
const CHECK_EVERY = 4_000;
const CHECK_FOR = 5 * 60_000;

interface Server {
  name: string;
  status: string;
}
/** A sign-in started from the dialog, until its server connects. */
interface SignIn {
  url: string;
  /** The page returns to the machine itself rather than finishing on its own site. */
  callback: boolean;
  error?: string;
  busy?: boolean;
}

/** The MCP servers this agent loaded, as its CLI reports them right now, with sign-in for those that need it. */
export function McpStatusDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: AgentInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [servers, setServers] = useState<Server[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setSignIns] = useState<Record<string, SignIn>>({});
  // A sign-in is over once its server reports itself connected.
  const signIns = Object.fromEntries(
    Object.entries(started).filter(
      ([name]) =>
        mcpStatusLabel(servers?.find((server) => server.name === name)?.status ?? "").tone !== "ok",
    ),
  );
  const canSignIn = !!agent.controls?.mcpSignIn;

  const request = async (operation: AgentOperation) => {
    if (!connection) throw new Error("Not connected to this machine.");
    const result = await connection.requestAgent(operation, crypto.randomUUID());
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
    if (result.outcome.servers) setServers(result.outcome.servers);
    return result.outcome;
  };
  const update = (name: string, change: Partial<SignIn>) =>
    setSignIns((current) => {
      const previous = current[name];
      return previous ? { ...current, [name]: { ...previous, ...change } } : current;
    });

  useEffect(() => {
    if (!open || !connection) return;
    let cancelled = false;
    connection.requestAgent({ kind: "mcp-status", sessionId: agent.id }, crypto.randomUUID()).then(
      (result) => {
        if (cancelled) return;
        if (result.outcome.status === "error") setError(result.outcome.message);
        else setServers(result.outcome.servers ?? []);
      },
      (cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not read MCP servers.");
      },
    );
    return () => {
      cancelled = true;
      setServers(null);
      setError(null);
      setSignIns({});
    };
  }, [open, connection, agent.id]);

  // A server connects once its page is done: one that returns to the machine on its own, a
  // claude.ai connector only once it is reconnected to pick up the sign-in made on claude.ai.
  const waiting = Object.entries(signIns)
    .filter(([, signIn]) => signIn.url && !signIn.busy)
    .map(([server, signIn]) => `${signIn.callback ? "status" : "check"}:${server}`)
    .sort()
    .join("\n");
  useEffect(() => {
    if (!open || !waiting || !connection) return;
    const until = Date.now() + CHECK_FOR;
    const timer = setInterval(() => {
      if (Date.now() > until) return clearInterval(timer);
      for (const entry of waiting.split("\n")) {
        const [how, ...rest] = entry.split(":");
        const server = rest.join(":");
        void request(
          how === "status"
            ? { kind: "mcp-status", sessionId: agent.id }
            : { kind: "mcp-auth", sessionId: agent.id, server, action: "check" },
        ).catch(() => undefined);
      }
    }, CHECK_EVERY);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request only sets state
  }, [open, waiting, connection, agent.id]);

  const start = async (server: string) => {
    setSignIns((current) => ({
      ...current,
      [server]: { url: "", callback: false, busy: true },
    }));
    try {
      const outcome = await request({
        kind: "mcp-auth",
        sessionId: agent.id,
        server,
        action: "start",
      });
      if (!outcome.mcpSignIn) throw new Error("This server did not offer a page to sign in on.");
      update(server, { ...outcome.mcpSignIn, busy: false });
      void openExternal(outcome.mcpSignIn.url).catch(() => undefined);
    } catch (cause) {
      update(server, {
        busy: false,
        error: cause instanceof Error ? cause.message : "Could not start signing in.",
      });
    }
  };
  const finish = async (server: string, callbackUrl: string) => {
    update(server, { busy: true, error: "" });
    try {
      await request({
        kind: "mcp-auth",
        sessionId: agent.id,
        server,
        action: "callback",
        callbackUrl,
      });
      update(server, { busy: false });
    } catch (cause) {
      update(server, {
        busy: false,
        error: cause instanceof Error ? cause.message : "That address did not finish signing in.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>MCP servers</DialogTitle>
          <DialogDescription>
            The MCP servers {agent.providerLabel ?? agentProviderName(agent.provider)} has loaded in
            this conversation. To add or change servers for every agent on this machine, go to
            Settings → MCP servers.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : !servers ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking servers…
          </p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">This agent has no MCP servers.</p>
        ) : (
          <ul
            aria-label="MCP server status"
            className="chat-scroll max-h-[60vh] divide-y overflow-y-auto rounded-md border text-sm"
          >
            {servers.map((server) => {
              const status = mcpStatusLabel(server.status);
              const signIn = signIns[server.name];
              const name =
                server.name === "concors-schedules" ? "Concors schedules (built in)" : server.name;
              return (
                <li key={server.name} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-xs">{name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`text-xs ${TONES[status.tone]}`}>{status.label}</span>
                      {canSignIn && status.label === "Needs sign-in" && !signIn?.url && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          disabled={signIn?.busy}
                          aria-label={`Sign in to ${server.name}`}
                          onClick={() => void start(server.name)}
                        >
                          {signIn?.busy ? "Opening…" : "Sign in"}
                        </Button>
                      )}
                    </span>
                  </div>
                  {signIn && (
                    <SignInProgress
                      server={server.name}
                      signIn={signIn}
                      onFinish={(url) => void finish(server.name, url)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SignInProgress({
  server,
  signIn,
  onFinish,
}: {
  server: string;
  signIn: SignIn;
  onFinish: (callbackUrl: string) => void;
}) {
  const [address, setAddress] = useState("");
  // A page that returns to the machine finishes by itself when the browser is on that machine.
  // Anywhere else it ends on an address that does not load, which is pasted back instead.
  const paste = signIn.callback;
  return (
    <div
      role="group"
      aria-label={`Signing in to ${server}`}
      className="mt-2 space-y-2 text-xs text-muted-foreground"
    >
      {signIn.url && (
        <p>
          Finish signing in in your browser.{" "}
          {paste
            ? "If it ends on a page that does not load, copy that page's address and paste it here."
            : "This updates by itself once you're done."}{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => void openExternal(signIn.url).catch(() => undefined)}
          >
            Open the sign-in page again
          </button>
        </p>
      )}
      {paste && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim()) onFinish(address.trim());
          }}
        >
          <Input
            aria-label={`Address your browser ended on for ${server}`}
            placeholder="http://localhost:…/callback?code=…"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="h-7 font-mono text-xs"
          />
          <Button
            type="submit"
            size="sm"
            className="h-7 text-xs"
            disabled={!address.trim() || signIn.busy}
          >
            Finish
          </Button>
        </form>
      )}
      {signIn.error && (
        <p role="alert" className="text-destructive">
          {signIn.error}
        </p>
      )}
    </div>
  );
}
