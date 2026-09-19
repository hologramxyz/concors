import type { AgentInfo } from "@concors/protocol";
import type { AccountBackend } from "../accounts/backend.ts";

/** Explicit injection for browser acceptance; production never selects this backend. */
export class TestAccountBackend implements AccountBackend {
  private done: ((error?: Error) => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private connected = false;
  private info: AgentInfo;
  constructor(info: AgentInfo) {
    this.info = info;
  }
  async read() {
    return {
      connected: this.connected,
      ...(this.connected ? { label: "fixture-account@example.test" } : {}),
      methods: [
        {
          id: "fixture",
          label: this.info.provider === "codex" ? "Sign in with ChatGPT" : "Connect account",
          kind: this.info.provider === "opencode" ? ("api-key" as const) : ("browser" as const),
        },
      ],
    };
  }
  async start(_method: string, done: (error?: Error) => void) {
    this.done = done;
    if (this.info.provider === "codex") {
      this.timer = setTimeout(() => {
        this.connected = true;
        done();
      }, 2500);
      return {
        url: "https://auth.openai.com/codex/device",
        code: "TEST-CODE",
        instructions: "Enter the code in your browser.",
      };
    }
    if (this.info.provider === "claude")
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
