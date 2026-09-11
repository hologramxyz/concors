import { z } from "zod";
import type { ConversationProvider } from "../providers/contract.ts";
import { browserUrl, type AccountBackend } from "./backend.ts";

export class CodexAccount implements AccountBackend {
  private ready: Promise<void>;
  private done: ((error?: Error) => void) | undefined;
  private loginId: string | undefined;
  private unsubscribe: (() => void) | undefined;
  private provider: ConversationProvider;
  constructor(provider: ConversationProvider) {
    this.provider = provider;
    provider.onFailure(() =>
      this.done?.(new Error("Codex sign-in stopped. Connect your account again.")),
    );
    this.ready = provider.initialize();
    void this.ready.catch(() => undefined);
  }
  async read() {
    await this.ready;
    const result = z
      .object({
        account: z
          .object({ type: z.string(), email: z.string().optional() })
          .passthrough()
          .nullable(),
        requiresOpenaiAuth: z.boolean().optional(),
      })
      .parse(await this.provider.request("account/read", { refreshToken: false }));
    return {
      connected: result.account !== null || result.requiresOpenaiAuth === false,
      ...(result.account?.email ? { label: result.account.email.slice(0, 250) } : {}),
      methods: [{ id: "chatgpt", label: "Sign in with ChatGPT", kind: "browser" as const }],
    };
  }
  async start(methodId: string, done: (error?: Error) => void) {
    if (methodId !== "chatgpt") throw new Error("Unknown sign-in method");
    await this.ready;
    this.done = done;
    this.unsubscribe = this.provider.onNotification((method, raw) => {
      const result = z.object({ loginId: z.string(), success: z.boolean() }).safeParse(raw);
      if (
        method === "account/login/completed" &&
        result.success &&
        result.data.loginId === this.loginId
      )
        done(
          result.data.success
            ? undefined
            : new Error(
                "ChatGPT sign-in failed. Try again and check that device-code login is enabled in ChatGPT security settings.",
              ),
        );
    });
    const result = z
      .object({ loginId: z.string(), verificationUrl: z.string(), userCode: z.string().max(100) })
      .parse(await this.provider.request("account/login/start", { type: "chatgptDeviceCode" }));
    this.loginId = result.loginId;
    return {
      url: browserUrl(result.verificationUrl),
      code: result.userCode,
      instructions:
        "Open ChatGPT in your browser and enter this code. You may need to enable device-code login in ChatGPT security settings.",
    };
  }
  complete(): Promise<void> {
    return Promise.reject(new Error("Approve the code in your browser"));
  }
  async close() {
    this.done = undefined;
    this.unsubscribe?.();
    if (this.loginId)
      void this.provider
        .request("account/login/cancel", { loginId: this.loginId })
        .catch(() => undefined);
    await this.provider.close();
  }
}
