import { expect, it } from "vitest";
import { LOCAL_HOST } from "@concors/client-core";
import type { AgentInfo, AgentTrigger } from "@concors/protocol";
import {
  createdTriggerId,
  webhookHostname,
  webhookUrl,
  webhookCurl,
  triggerTargetLabel,
} from "./helpers";

it("pairs a one-time secret only with the unambiguous newly created trigger", () => {
  const trigger = (id: string, secretHint: string) => ({ id, secretHint }) as AgentTrigger;
  const before = [trigger("old", "1234")];
  expect(
    createdTriggerId(
      before,
      [...before, trigger("other-client", "5678"), trigger("created", "1234")],
      "cwh_1234",
    ),
  ).toBe("created");
  expect(createdTriggerId(before, before, "cwh_1234")).toBeNull();
  expect(createdTriggerId([], [], "")).toBeNull();
  expect(createdTriggerId([], [trigger("a", "1234"), trigger("b", "1234")], "cwh_1234")).toBeNull();
});

it("builds HTTPS hook URLs only from a hostname", () => {
  expect(webhookUrl("machine.example.com", "hook/id")).toBe(
    "https://machine.example.com/hooks/hook%2Fid",
  );
  for (const invalid of [
    null,
    "",
    "https://example.com",
    "example.com/path",
    "example.com:8443",
    "user@example.com",
    "example.com?x=y",
    "example.com#fragment",
  ])
    expect(webhookUrl(invalid, "id")).toBeNull();
});
it("uses the managed machine hostname, never the local connection", () => {
  expect(webhookHostname(LOCAL_HOST)).toBeNull();
  expect(
    webhookHostname({
      machineId: "cloud",
      label: "Cloud",
      preferredConnectionId: null,
      connections: [{ id: "direct", kind: "direct", url: "wss://machine.example.com/ws" }],
    }),
  ).toBe("machine.example.com");
  expect(webhookHostname({ ...LOCAL_HOST, machineId: "cloud", connections: [] })).toBeNull();
});
it("builds a runnable shell-quoted curl command without exposing a fake local URL", () => {
  expect(webhookCurl(null, "secret")).toBe("");
  const curl = webhookCurl("https://machine.example.com/hooks/id", "cwh_a'b");
  expect(curl.split(" \\\n")).toEqual([
    "curl -X POST 'https://machine.example.com/hooks/id'",
    `  -H 'Authorization: Bearer cwh_a'"'"'b'`,
    "  -H 'Idempotency-Key: abc'",
    "  -H 'X-Concors-Source: stream'",
    "  -H 'Content-Type: application/json'",
    `  -d '{"note":"..."}'`,
  ]);
});
it("labels current, missing and fresh chat targets", () => {
  const trigger = {
    target: { kind: "session", sessionId: "chat" },
    sessionId: null,
  } as AgentTrigger;
  expect(triggerTargetLabel(trigger, [{ id: "chat", name: "Builds" } as AgentInfo])).toBe("Builds");
  expect(triggerTargetLabel(trigger, [])).toBe("Chat unavailable");
  expect(triggerTargetLabel({ ...trigger, target: { kind: "supervisor" } }, [])).toBe("Supervisor");
  expect(
    triggerTargetLabel(
      { ...trigger, target: { kind: "agent", provider: "codex", model: null } },
      [],
    ),
  ).toBe("New codex chat");
});
