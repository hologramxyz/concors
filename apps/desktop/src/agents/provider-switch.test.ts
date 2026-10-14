import { expect, it } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import {
  hasConversation,
  setAsideConversation,
  switchConfirmation,
  switchDescription,
} from "./provider-switch";

const agent = (patch: Partial<AgentInfo>): AgentInfo =>
  ({
    id: "codex",
    projectId: "project",
    directory: "/repo",
    provider: "codex",
    providerLabel: "Codex",
    threadId: "thread",
    turnStartedAt: null,
    ...patch,
  }) as AgentInfo;

it("finds the conversation a pane set aside for a provider, and nothing from other panes", () => {
  const codex = agent({ providerGroupId: "codex", turnStartedAt: "2026-10-13T00:00:00.000Z" });
  const claude = agent({ id: "claude", provider: "claude", providerGroupId: "codex" });
  const elsewhere = agent({ id: "other", provider: "opencode", providerGroupId: "another-pane" });
  const agents = [codex, claude, elsewhere];
  expect(setAsideConversation(agents, claude, "codex")).toBe(codex);
  expect(setAsideConversation(agents, claude, "opencode")).toBeUndefined();
  expect(switchDescription(agents, claude, "claude")).toBe("Current conversation");
  expect(switchDescription(agents, claude, "codex")).toBe("Back to its conversation in this pane");
  expect(switchDescription(agents, claude, "opencode")).toBe(
    "Starts a new conversation in this pane",
  );
});

it("only confirms switches that would set a conversation with content aside", () => {
  expect(hasConversation(agent({}))).toBe(false);
  expect(hasConversation(agent({ turnStartedAt: "2026-10-13T00:00:00.000Z" }))).toBe(true);
  expect(hasConversation(agent({ nativeImport: true }))).toBe(true);
  const codex = agent({ turnStartedAt: "2026-10-13T00:00:00.000Z" });
  expect(switchConfirmation([codex], codex, "claude", "Claude Code")).toEqual({
    title: "Start a new Claude Code conversation?",
    description:
      "Claude Code can't continue this Codex conversation, so this pane starts a new one. Your Codex conversation is kept: switch back to Codex to return to it.",
    action: "Start new conversation",
  });
});
