import { describe, expect, it } from "vitest";
import type { ProviderStatus } from "@concors/protocol";
import { subscriptionConfig, subscriptionGroups, subscriptionId } from "./subscriptions";

const status = (overrides: Partial<ProviderStatus>): ProviderStatus => ({
  id: "claude",
  label: "Claude Code",
  engine: "claude",
  command: ["claude"],
  enabled: true,
  envKeys: [],
  installed: true,
  customized: false,
  canInstall: true,
  installStatus: "idle",
  ...overrides,
});

describe("subscriptionGroups", () => {
  it("pairs each engine's built-in sign-in with its extra subscriptions, sorted by label", () => {
    const providers = [
      status({}),
      status({ id: "codex", label: "Codex", engine: "codex", command: ["codex"] }),
      status({ id: "opencode", label: "OpenCode", engine: "opencode", command: ["opencode"] }),
      status({
        id: "claude-work-1",
        label: "Claude — Work",
        subscription: { nickname: "Work" },
      }),
      status({
        id: "claude-personal-1",
        label: "Claude — Personal",
        subscription: { nickname: "Personal" },
      }),
    ];
    const groups = subscriptionGroups(providers);
    expect(groups.map((g) => g.engine)).toEqual(["claude", "codex"]);
    expect(groups[0]?.base?.id).toBe("claude");
    expect(groups[0]?.subscriptions.map((s) => s.id)).toEqual([
      "claude-personal-1",
      "claude-work-1",
    ]);
    expect(groups[1]?.base?.id).toBe("codex");
    expect(groups[1]?.subscriptions).toEqual([]);
  });
  it("never treats a subscription as the built-in account, even with a colliding engine id", () => {
    const groups = subscriptionGroups([
      status({ id: "codex", engine: "codex", subscription: { nickname: "Odd" } }),
    ]);
    expect(groups[1]?.base).toBeUndefined();
    expect(groups[1]?.subscriptions.map((s) => s.id)).toEqual(["codex"]);
  });
});

describe("subscriptionConfig", () => {
  it("builds a valid provider configuration reusing the base command", () => {
    const config = subscriptionConfig(
      "codex",
      "  Work Account  ",
      { command: ["/opt/bin/codex", "--flag"] },
      "ab12",
    );
    expect(config).toMatchObject({
      id: "codex-work-account-ab12",
      label: "ChatGPT — Work Account",
      engine: "codex",
      command: ["/opt/bin/codex", "--flag"],
      enabled: true,
      subscription: { nickname: "Work Account" },
    });
  });
  it("falls back to the engine binary and survives symbol-only nicknames", () => {
    const config = subscriptionConfig("claude", "工作", undefined, "cd34");
    expect(config.command).toEqual(["claude"]);
    expect(config.id).toBe("claude-cd34");
    expect(subscriptionId("claude", "A".repeat(80), "x")).toHaveLength(
      "claude-".length + 40 + "-x".length,
    );
  });
});
