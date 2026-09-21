import type { AccountBackend } from "../accounts/backend.ts";
import type { AccountTarget } from "../accounts/manager.ts";

/** Explicit injection for browser acceptance; production never selects this backend. */
export class TestAccountBackend implements AccountBackend {
  private done: ((error?: Error) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private connected = false;
  private info: AccountTarget;
  constructor(info: AccountTarget) {
    this.info = info;
  }
  async read() {
    const engine = this.info.provider.split("-", 1)[0];
    return {
      connected: this.connected,
      ...(this.connected ? { label: "fixture-account@example.test" } : {}),
      methods: [
        {
          id: "fixture",
          label: engine === "codex" ? "Sign in with ChatGPT" : "Connect account",
          kind: engine === "opencode" ? ("api-key" as const) : ("browser" as const),
        },
      ],
    };
  }
  async start(_method: string, done: (error?: Error) => void) {
    this.done = done;
    const engine = this.info.provider.split("-", 1)[0];
    if (engine === "codex") {
      // Provider-level flows outlast the settings catalog poll to catch accidental cancellation.
      this.timer = setTimeout(
        () => {
          this.connected = true;
          done();
        },
        this.info.id.startsWith("provider-account:codex-") ? 5200 : 2500,
      );
      return {
        url: "https://auth.openai.com/codex/device",
        code: "TEST-CODE",
        instructions: "Enter the code in your browser.",
      };
    }
    if (engine === "claude")
      return { url: "https://claude.com/cai/oauth/authorize", input: "code" as const };
    return { input: "api-key" as const };
  }
  async complete(value: string) {
    if (!value.startsWith("test-")) throw new Error("Invalid fixture code");
    this.connected = true;
    this.done?.();
  }
  async close() {
    clearTimeout(this.timer);
  }
}
