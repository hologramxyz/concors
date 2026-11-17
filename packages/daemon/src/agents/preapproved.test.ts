import { expect, it } from "vitest";
import { preapprovedTool } from "./preapproved.ts";

const ask = "item/commandExecution/requestApproval";
it("trusts only the names a harness gives its own tool calls", () => {
  const server = "concors-supervisor";
  expect(
    preapprovedTool("claude", server, ask, { reason: "mcp__concors-supervisor__concors_control" }),
  ).toBe(true);
  expect(preapprovedTool("claude", server, ask, { reason: "Bash" })).toBe(false);
  expect(preapprovedTool("claude", server, ask, { reason: "mcp__other__concors_control" })).toBe(
    false,
  );
  expect(
    preapprovedTool("opencode", server, ask, { reason: "concors-supervisor_concors_control" }),
  ).toBe(true);
  // Codex's reason is the model's own explanation of a command, so it can never grant anything.
  expect(
    preapprovedTool("codex", server, ask, { reason: "mcp__concors-supervisor__concors_control" }),
  ).toBe(false);
  expect(
    preapprovedTool("codex", server, "mcpServer/elicitation/request", { serverName: server }),
  ).toBe(true);
  expect(
    preapprovedTool("claude", server, "item/fileChange/requestApproval", {
      reason: "mcp__concors-supervisor__concors_control",
    }),
  ).toBe(false);
});
