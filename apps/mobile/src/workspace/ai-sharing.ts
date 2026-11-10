import type { DaemonConnection } from "@concors/daemon-client";
import type { ClientMessage, DaemonMessage, ProviderStatus } from "@concors/protocol";
import { newRequestId } from "@concors/client-core";

/** App Store consent belongs to the native iOS app, never desktop, Android or web previews. */
export function requiresAISharingPermission(platform: string, demo: boolean) {
  return platform === "ios" && !demo;
}

export interface AISharingDisclosure {
  summary: string;
  details: string;
}

type Context = Pick<DaemonConnection, "agents" | "schedules" | "requestProvider">;
type Gated = Extract<
  ClientMessage,
  { type: "agent.request" | "provider.request" | "schedule.request" }
>;
const READ_ONLY = new Set(["list-messages", "seen", "pin", "delete", "interrupt", "queue-remove"]);

function gated(message: ClientMessage): message is Gated {
  if (message.type === "agent.request") {
    const op = message.operation;
    if (READ_ONLY.has(op.kind)) return false;
    if (op.kind === "respond" && (op.decision === "decline" || op.decision === "cancel"))
      return false;
    if (op.kind === "queue-pause" && op.paused) return false;
    return true;
  }
  if (message.type === "provider.request")
    return !["list", "remove"].includes(message.operation.kind);
  if (message.type === "schedule.request")
    return !["list", "delete"].includes(message.operation.kind);
  return false;
}
function rejected(message: Gated, text: string): DaemonMessage {
  const outcome = { status: "error" as const, message: text };
  if (message.type === "agent.request")
    return { type: "agent.result", requestId: message.requestId, outcome };
  if (message.type === "provider.request")
    return { type: "provider.result", requestId: message.requestId, outcome };
  return { type: "schedule.result", requestId: message.requestId, outcome };
}
function selected(message: Gated, context: Context) {
  const op = message.operation;
  if (message.type === "agent.request") {
    const agent =
      "sessionId" in op ? context.agents.find((item) => item.id === op.sessionId) : undefined;
    return {
      provider: "provider" in op ? op.provider : agent?.provider,
      model: "model" in op ? op.model : "settings" in op ? op.settings.model : agent?.model,
    };
  }
  if (message.type === "provider.request") {
    return {
      provider: "id" in op ? op.id : "provider" in op ? op.provider : undefined,
      model: null,
    };
  }
  const schedule =
    "schedule" in op
      ? op.schedule
      : "id" in op
        ? context.schedules?.find((item) => item.id === op.id)
        : undefined;
  const target = schedule?.target;
  const agent =
    target?.kind === "session"
      ? context.agents.find((item) => item.id === target.sessionId)
      : undefined;
  return {
    provider: target?.kind === "agent" ? target.provider : agent?.provider,
    model: target?.kind === "agent" ? target.model : agent?.model,
  };
}
function recipient(provider: ProviderStatus) {
  const vendor =
    provider.engine === "codex"
      ? "OpenAI / Codex"
      : provider.engine === "claude"
        ? "Anthropic / Claude"
        : `${provider.label}'s configured model service`;
  return `${provider.label} (${vendor})${provider.customized ? "; custom configuration: check its endpoints on desktop" : ""}${provider.mcpServerNames?.length ? `; connected tools: ${provider.mcpServerNames.join(", ")}` : ""}`;
}

interface SavedPermission {
  blocked: boolean;
  grant: string | null;
}

/** One account/machine record. Serialize writes so withdrawal wins over an earlier approval. */
export function createAISharingStore(storage: {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}) {
  let loaded: Promise<SavedPermission> | undefined;
  let writes: Promise<void> = Promise.resolve();
  const prompts = new Map<string, Promise<boolean>>();
  let promptQueue: Promise<unknown> = Promise.resolve();
  return {
    read() {
      return (loaded ??= storage.read().then((raw): SavedPermission => {
        try {
          const saved = JSON.parse(raw ?? "null") as SavedPermission | null;
          if (
            saved &&
            typeof saved.blocked === "boolean" &&
            (saved.grant === null || typeof saved.grant === "string")
          )
            return saved;
        } catch {
          /* A missing or invalid record requires fresh permission. */
        }
        return { blocked: false, grant: null };
      }));
    },
    confirm(key: string, ask: () => Promise<boolean>) {
      let pending = prompts.get(key);
      if (!pending) {
        pending = promptQueue.then(ask);
        prompts.set(key, pending);
        promptQueue = pending.catch(() => undefined);
        // Keep an explicit approval for a replacement controller that joins just after the
        // dialog closes. It still rechecks the recipients before sending anything.
        void pending.then(
          (allowed) => {
            if (!allowed) prompts.delete(key);
          },
          () => prompts.delete(key),
        );
      }
      return pending;
    },
    write(value: SavedPermission) {
      if (value.grant === null) prompts.clear();
      else for (const key of prompts.keys()) if (key !== value.grant) prompts.delete(key);
      loaded = Promise.resolve(value);
      const next = writes.catch(() => undefined).then(() => storage.write(JSON.stringify(value)));
      writes = next;
      return next;
    },
  };
}

/** Approval covers the named recipients on one account/machine, across conversations and
 * reconnects. Registry revisions invalidate it even when private endpoint values are redacted. */
export function createAISharingPermission(
  context: Context,
  ask: (disclosure: AISharingDisclosure) => Promise<boolean>,
  changed: (state: "ask" | "allowed" | "blocked") => void = () => undefined,
  store?: ReturnType<typeof createAISharingStore>,
) {
  const grants = new Set<string>();
  const pending = new Map<string, Promise<boolean>>();
  let generation = 0,
    blocked = false,
    disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const describe = async (message: Gated) => {
    const result = await context.requestProvider(
      { kind: "list", checkVersions: false },
      newRequestId(),
    );
    if (result.outcome.status !== "ok") throw new Error("Provider discovery failed");
    const target = selected(message, context);
    // Disclose the machine's configured recipients together: restoring several conversations
    // must not ask again for every agent or model using those same services.
    let providers = result.outcome.providers.filter((p) => p.enabled || p.id === target.provider);
    if (message.type === "provider.request" && message.operation.kind === "save") {
      const proposed = message.operation.config;
      providers = [
        {
          ...proposed,
          envKeys: Object.keys(proposed.env ?? {}),
          customized: true,
          mcpServerNames: proposed.params?.mcpServers?.map((s) => s.name),
          installed: false,
          canInstall: false,
          installStatus: "idle",
        },
      ];
    }
    // Keep large registries usable without presenting an unreadable machine-wide alert.
    if (providers.length > 12 && target.provider)
      providers = providers.filter((provider) => provider.id === target.provider);
    if (!providers.length || providers.length > 12)
      throw new Error("Choose a configured provider before continuing");
    providers.sort((a, b) => a.id.localeCompare(b.id));
    const names = providers.map(recipient);
    const destinations = [
      ...new Set(
        providers.flatMap((provider) => [
          provider.customized
            ? `${provider.label}'s configured AI service`
            : provider.engine === "codex"
              ? "OpenAI"
              : provider.engine === "claude"
                ? "Anthropic"
                : `${provider.label}'s configured AI service`,
          ...(provider.mcpServerNames ?? []),
        ]),
      ),
    ];
    return {
      key: JSON.stringify([
        result.outcome.revision,
        providers.map((p) => [p.id, p.engine, p.label, p.customized, p.mcpServerNames]),
      ]),
      summary: `Send prompts, code, files and chat context to ${destinations.join(", ")}?`,
      details: `Recipients: ${names.join("\n\n")}\nModels: those configured for these services on your machine\n\nOpening a conversation can resume its agent. Your prompts, code, attachments, conversation history and tool context may be sent from your connected machine to these AI services and configured tools. Their retention and training rules depend on your provider/account settings. Check custom endpoints and tool recipients on desktop before agreeing.\n\nAllow sharing with these services on this machine? Your choice is saved on this device for this account and machine. You will be asked again if the configuration changes. You can withdraw permission in Settings → Account → AI data sharing. Existing work on your machine keeps running until you stop it.`,
    };
  };
  return {
    async withdraw() {
      blocked = true;
      generation++;
      grants.clear();
      changed("blocked");
      await store?.write({ blocked: true, grant: null });
    },
    async review() {
      blocked = false;
      generation++;
      grants.clear();
      changed("ask");
      await store?.write({ blocked: false, grant: null });
    },
    dispose() {
      disposed = true;
      generation++;
      grants.clear();
    },
    async beforeSend(message: ClientMessage): Promise<DaemonMessage | null> {
      if (!gated(message)) return null;
      if (disposed || blocked)
        return rejected(
          message,
          "AI sharing is off. Review permission in Settings → Account → AI data sharing.",
        );
      const version = generation;
      try {
        const disclosure = await describe(message);
        const saved = await store?.read();
        if (saved?.blocked) {
          blocked = true;
          changed("blocked");
        }
        if (disposed || blocked || generation !== version)
          return rejected(message, "AI sharing permission changed. Try again.");
        if (
          (grants.has(disclosure.key) || saved?.grant === disclosure.key) &&
          !(message.type === "provider.request" && message.operation.kind === "save")
        ) {
          changed("allowed");
          return null;
        }
        let approval = pending.get(disclosure.key);
        if (!approval) {
          approval = queue.then(async () => {
            if (disposed || blocked || generation !== version) return false;
            const question = () =>
              ask({ summary: disclosure.summary, details: disclosure.details });
            const allowed = await (store ? store.confirm(disclosure.key, question) : question());
            if (!allowed && !disposed && generation === version) {
              blocked = true;
              generation++;
              grants.clear();
              changed("blocked");
              await store?.write({ blocked: true, grant: null });
            }
            if (!allowed || disposed || blocked || generation !== version) return false;
            const current = await describe(message);
            if (current.key !== disclosure.key) return false;
            await store?.write({ blocked: false, grant: disclosure.key });
            if (disposed || blocked || generation !== version) return false;
            grants.add(disclosure.key);
            changed("allowed");
            return true;
          });
          pending.set(disclosure.key, approval);
          queue = approval.catch(() => undefined);
          void approval.finally(() => pending.delete(disclosure.key)).catch(() => undefined);
        }
        return (await approval) && !disposed && !blocked && version === generation
          ? null
          : rejected(message, "AI sharing was not allowed. Your request was not sent.");
      } catch {
        return rejected(
          message,
          "Could not verify the AI recipients. Check the provider configuration and retry.",
        );
      }
    },
  };
}
