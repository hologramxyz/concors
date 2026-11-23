import { expect, it } from "vitest";
import { AgentInfoSchema, AgentRequestSchema } from "./agents.ts";
import { TriggerDefinitionSchema } from "./triggers.ts";

let ids = 0;
const randomUUID = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

it("keeps queue snapshots within the bounds understood by existing v1 clients", () => {
  const entry = {
    id: randomUUID(),
    text: "x".repeat(16000),
    attachments: [],
    queuedAt: "2026-11-23T00:00:00.000Z",
  };
  const queue = AgentInfoSchema.shape.queue;
  expect(queue.safeParse(Array.from({ length: 20 }, () => entry)).success).toBe(true);
  expect(queue.safeParse(Array.from({ length: 21 }, () => entry)).success).toBe(false);
  expect(queue.safeParse([{ ...entry, text: "x".repeat(16001) }]).success).toBe(false);
});

it("accepts empty instructions but rejects slash commands and new Supervisor chats", () => {
  const definition = {
    name: "CI",
    projectId: null,
    prompt: "",
    target: { kind: "supervisor" },
    mode: "same",
    enabled: true,
  };
  expect(TriggerDefinitionSchema.safeParse(definition).success).toBe(true);
  expect(TriggerDefinitionSchema.safeParse({ ...definition, prompt: "/approve" }).success).toBe(
    false,
  );
  expect(TriggerDefinitionSchema.safeParse({ ...definition, mode: "new" }).success).toBe(false);
});

it("does not let client agent requests set trigger labels", () => {
  const trigger = { triggerId: randomUUID(), eventId: randomUUID(), source: "spoofed" };
  for (const kind of ["send", "queue-add"] as const) {
    const request = AgentRequestSchema.parse({
      type: "agent.request",
      requestId: randomUUID(),
      trigger,
      operation: { kind, sessionId: randomUUID(), text: "hello", trigger },
    });
    expect(request).not.toHaveProperty("trigger");
    expect(request.operation).not.toHaveProperty("trigger");
  }
});
