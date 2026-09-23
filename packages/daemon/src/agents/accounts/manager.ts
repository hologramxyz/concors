import { randomUUID } from "node:crypto";
import {
  AgentAccountSchema,
  type AgentAccount,
  type AgentAccountAction,
  type AgentInfo,
} from "@concors/protocol";
import { ProviderRegistry } from "../providers/registry.ts";
import { CodexAppServer } from "../codex/app-server.ts";
import { OpenCodeProvider } from "../providers/opencode.ts";
import { ClaudeAccount } from "./claude.ts";
import { CodexAccount } from "./codex.ts";
import { OpenCodeAccount } from "./opencode.ts";
import type { AccountBackend } from "./backend.ts";

/** What an account flow needs to address a backend; sessions and provider configs both qualify. */
export type AccountTarget = Pick<AgentInfo, "id" | "provider" | "directory"> & {
  /**
   * Address the configuration's own credential home instead of the one its chats run under.
   * Settings sign-in sets it, so connecting the default account never touches the active one.
   */
  ownCredentials?: boolean;
};
export type AccountBackendFactory = (info: AccountTarget) => AccountBackend;
export const accountBackendFactory =
  (registry: ProviderRegistry): AccountBackendFactory =>
  (info) => {
    const config = registry.config(info.provider);
    const refuse = async () => {
      throw new Error("Sign-in cannot approve agent tools");
    };
    if (!["claude", "codex", "opencode"].includes(config.engine))
      throw new Error("Sign in through this agent's CLI on the machine.");
    // A chat checks and renews the account it runs under, the machine-wide active subscription
    // included; Settings addresses each configuration's own credential home.
    const launcher = registry.launcher(config, !info.ownCredentials);
    if (config.engine === "claude") return new ClaudeAccount(info.directory, launcher);
    if (config.engine === "codex")
      return new CodexAccount(
        new CodexAppServer(
          launcher("codex", ["app-server", "--listen", "stdio://"], info.directory),
          refuse,
        ),
      );
    return new OpenCodeAccount(new OpenCodeProvider(info.directory, refuse, launcher));
  };
const createAccountBackend = accountBackendFactory(new ProviderRegistry());
interface Entry {
  owner: string;
  backend: AccountBackend;
  state: AgentAccount;
  busy: boolean;
  timer: ReturnType<typeof setTimeout>;
}
/** Socket-scoped sign-in state. Never broadcast, logged, or stored in conversation receipts. */
export class AgentAccounts {
  private entries = new Map<string, Entry>();
  private requests = new Set<string>();
  private factory: AccountBackendFactory;
  private connected: (info: AccountTarget) => void;
  constructor(
    factory: AccountBackendFactory = createAccountBackend,
    connected: (info: AccountTarget) => void = () => undefined,
  ) {
    this.factory = factory;
    this.connected = connected;
  }
  private async remove(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    clearTimeout(entry.timer);
    await entry.backend.close().catch(() => undefined);
  }
  async request(
    owner: string,
    info: AccountTarget,
    action: AgentAccountAction,
  ): Promise<AgentAccount> {
    const key = JSON.stringify([owner, info.id]);
    if (this.requests.has(key)) throw new Error("Account request is already in progress");
    this.requests.add(key);
    try {
      return await this.perform(key, owner, info, action);
    } finally {
      this.requests.delete(key);
    }
  }
  private async perform(
    key: string,
    owner: string,
    info: AccountTarget,
    action: AgentAccountAction,
  ): Promise<AgentAccount> {
    let entry = this.entries.get(key);
    if (entry?.busy) throw new Error("Account request is already in progress");
    if (action.type === "cancel") {
      if (entry?.state.challenge?.flowId !== action.flowId) throw new Error("Sign-in has expired");
      await this.remove(key);
      return { status: "disconnected", methods: entry.state.methods };
    }
    if (action.type === "complete" && entry?.state.challenge?.flowId !== action.flowId)
      throw new Error("Sign-in has expired. Connect your account again.");
    if (action.type === "start" && entry) {
      await this.remove(key);
      entry = undefined;
    }
    if (!entry) {
      if (this.entries.size >= 32)
        throw new Error("Too many account connections. Close an unused sign-in panel.");
      entry = {
        owner,
        backend: this.factory(info),
        state: { status: "unknown", methods: [] },
        busy: false,
        timer: setTimeout(() => void this.remove(key), 120000),
      };
      entry.timer.unref();
      this.entries.set(key, entry);
    }
    const current = entry;
    current.busy = true;
    try {
      if (action.type === "read" && (current.state.status === "pending" || current.state.message))
        return current.state;
      if (action.type !== "complete") {
        const read = await current.backend.read();
        if (this.entries.get(key) !== current) throw new Error("Account connection closed");
        current.state = {
          status: read.connected ? "connected" : "disconnected",
          methods: read.methods,
          ...(read.label ? { label: read.label } : {}),
        };
      }
      if (action.type === "start") {
        const flowId = randomUUID();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        clearTimeout(current.timer);
        current.timer = setTimeout(() => void this.remove(key), 10 * 60 * 1000);
        current.timer.unref();
        current.state = {
          status: "pending",
          methods: current.state.methods,
          challenge: { flowId, expiresAt },
        };
        const challenge = await current.backend.start(action.methodId, (error) => {
          if (this.entries.get(key) !== current || current.state.challenge?.flowId !== flowId)
            return;
          current.state = {
            status: error ? "disconnected" : "connected",
            methods: current.state.methods,
            ...(error ? { message: error.message.slice(0, 1000) } : {}),
          };
          if (!error) this.connected(info);
        });
        if (current.state.status === "pending")
          current.state.challenge = { ...challenge, flowId, expiresAt };
      }
      if (action.type === "complete") await current.backend.complete(action.value);
      return AgentAccountSchema.parse(current.state);
    } catch {
      if (this.entries.get(key) === current) await this.remove(key);
      // Provider exceptions can include process output or submitted keys. Never return them.
      throw new Error(
        action.type === "read"
          ? "Could not check this account. You can keep using the agent or try again."
          : info.provider === "codex"
            ? "Could not connect ChatGPT. Try again and check that device-code login is enabled in your ChatGPT security settings."
            : "Could not connect the account. Try again.",
      );
    } finally {
      current.busy = false;
    }
  }
  async detach(owner: string) {
    await Promise.all(
      [...this.entries].filter(([, e]) => e.owner === owner).map(([key]) => this.remove(key)),
    );
  }
  async close() {
    await Promise.all([...this.entries.keys()].map((key) => this.remove(key)));
  }
}
