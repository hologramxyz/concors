import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { AgentAccountMethod } from "@concors/protocol";
import type { ConversationProvider } from "../providers/contract.ts";
import { browserUrl, type AccountBackend, type AccountChallenge } from "./backend.ts";

const Provider = z.object({ id: z.string(), name: z.string(), source: z.string().optional() });
/** Only credential provider IDs leave this function, never keys or OAuth tokens. */
async function credentialIds(): Promise<string[]> {
  const data = process.env["XDG_DATA_HOME"];
  const directory = data && isAbsolute(data) ? data : join(homedir(), ".local", "share");
  let raw = process.env["OPENCODE_AUTH_CONTENT"];
  if (!raw)
    raw = await readFile(join(directory, "opencode", "auth.json"), "utf8").catch(() => "{}");
  const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(raw));
  return parsed.success ? Object.keys(parsed.data) : [];
}
const Method = z.object({
  type: z.enum(["oauth", "api"]),
  label: z.string(),
  prompts: z.array(z.unknown()).optional(),
});
export class OpenCodeAccount implements AccountBackend {
  private ready: Promise<void>;
  private choices = new Map<
    string,
    { provider: string; method: number; kind: "browser" | "api-key" }
  >();
  private selected: { provider: string; method: number; kind: "browser" | "api-key" } | undefined;
  private done: ((error?: Error) => void) | undefined;
  private provider: ConversationProvider;
  private credentials: () => Promise<string[]>;
  constructor(provider: ConversationProvider, credentials = credentialIds) {
    this.provider = provider;
    this.credentials = credentials;
    this.ready = provider.initialize();
    void this.ready.catch(() => undefined);
  }
  async read() {
    await this.ready;
    const catalog = z
      .object({ all: z.array(Provider), connected: z.array(z.string()) })
      .parse(await this.provider.request("account/providers"));
    const auth = z
      .record(z.string(), z.array(Method))
      .parse(await this.provider.request("account/methods"));
    const methods: AgentAccountMethod[] = [];
    this.choices.clear();
    for (const p of catalog.all) {
      const choices = auth[p.id] ?? [{ type: "api" as const, label: "API key" }];
      choices.forEach((method, index) => {
        // Interactive plugin questionnaires need their own integration. Prefer headless
        // OAuth where offered: a localhost browser callback cannot reach a remote VPS.
        if (
          method.prompts?.length ||
          (method.type === "oauth" &&
            /browser/i.test(method.label) &&
            choices.some((m) => /headless/i.test(m.label)))
        )
          return;
        const id = `${p.id}:${index}`;
        const kind = method.type === "api" ? ("api-key" as const) : ("browser" as const);
        this.choices.set(id, { provider: p.id, method: index, kind });
        methods.push({
          id,
          label: `${p.name} — ${method.label.replace(/\(headless\)/i, "(device code)")}`.slice(
            0,
            250,
          ),
          kind,
        });
      });
    }
    const credentials = await this.credentials();
    const authenticated = catalog.connected.filter(
      (id) =>
        credentials.includes(id) ||
        catalog.all.some((p) => p.id === id && ["api", "env"].includes(p.source ?? "")),
    );
    return {
      connected: authenticated.length > 0,
      ...(authenticated.length
        ? {
            label: authenticated
              .map((id) => catalog.all.find((p) => p.id === id)?.name ?? id)
              .join(", ")
              .slice(0, 250),
          }
        : {}),
      methods: methods.slice(0, 1000),
    };
  }
  async start(methodId: string, done: (error?: Error) => void): Promise<AccountChallenge> {
    const selected = this.choices.get(methodId);
    if (!selected) throw new Error("Unknown sign-in method");
    this.selected = selected;
    this.done = done;
    if (selected.kind === "api-key")
      return {
        input: "api-key" as const,
        instructions: "Your key is saved by OpenCode on this machine.",
      };
    const response = z
      .object({ url: z.string(), method: z.enum(["auto", "code"]), instructions: z.string() })
      .parse(await this.provider.request("account/authorize", selected));
    if (response.method === "auto") {
      void this.provider.request("account/callback", selected).then(
        () => done(),
        () => done(new Error("OpenCode sign-in failed or expired. Try again.")),
      );
    }
    return {
      url: browserUrl(response.url),
      instructions: response.instructions.slice(0, 1000),
      ...(response.method === "code" ? { input: "code" as const } : {}),
    };
  }
  async complete(value: string) {
    if (!this.selected) throw new Error("Sign-in has expired");
    await this.provider.request(
      this.selected.kind === "api-key" ? "account/key" : "account/callback",
      { ...this.selected, value },
    );
    this.done?.();
  }
  async close() {
    this.done = undefined;
    await this.provider.close();
  }
}
