import { expect, it } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { defaultProvider } from "./default-provider";

const agent = (
  provider: string,
  turnStartedAt: string | null,
  updatedAt = "2026-10-01T10:00:00Z",
) => ({ id: crypto.randomUUID(), provider, turnStartedAt, updatedAt }) as AgentInfo;

it("starts with the provider whose chat last had a turn", () => {
  const agents = [
    agent("codex", "2026-10-01T09:00:00Z"),
    agent("claude", "2026-10-02T09:00:00Z"),
    // Opened since, but never used.
    agent("codex", null, "2026-10-03T09:00:00Z"),
  ];
  expect(defaultProvider(["codex", "claude"], agents)).toBe("claude");
});

it("skips providers that are no longer installed, then falls back to the first installed", () => {
  const agents = [agent("claude", "2026-10-02T09:00:00Z")];
  expect(defaultProvider(["codex", "opencode"], agents)).toBe("codex");
  expect(defaultProvider(["opencode"], [])).toBe("opencode");
});

it("has no default when nothing is installed", () => {
  expect(defaultProvider([], [agent("claude", "2026-10-02T09:00:00Z")])).toBeNull();
});
