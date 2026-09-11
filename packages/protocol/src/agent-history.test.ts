import { expect, it } from "vitest";
import { AgentOperationSchema } from "./agents.ts";
const read = { kind: "read", sessionId: "00000000-0000-4000-8000-000000000001" };
it("supports exclusive history cursors in either direction, including position zero", () => {
  for (const cursor of [{}, { before: 0 }, { before: 80 }, { after: 0 }, { after: 80 }])
    expect(AgentOperationSchema.parse({ ...read, ...cursor })).toEqual({ ...read, ...cursor });
});
it("rejects ambiguous, negative and fractional history cursors", () => {
  for (const cursor of [{ before: 80, after: 0 }, { before: -1 }, { after: -1 }, { after: 1.5 }])
    expect(AgentOperationSchema.safeParse({ ...read, ...cursor }).success).toBe(false);
});
