import { expect, it } from "vitest";
import { elicitationContent, elicitationQuestions } from "./elicitation.ts";
it("preserves typed MCP answers and rejects invalid choices and required omissions", () => {
  const schema = {
    type: "object",
    required: ["port", "confirm"],
    properties: {
      port: { type: "integer", minimum: 1, maximum: 65535 },
      confirm: { type: "boolean" },
      tags: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      note: { type: "string" },
    },
  };
  expect(elicitationQuestions(schema).find((q) => q.id === "tags")).toMatchObject({
    multiSelect: true,
    required: false,
  });
  expect(
    elicitationContent(schema, { port: ["8080"], confirm: ["false"], tags: ["a", "b"] }),
  ).toEqual({ port: 8080, confirm: false, tags: ["a", "b"] });
  expect(() => elicitationContent(schema, { port: ["0"], confirm: ["true"] })).toThrow();
  expect(() => elicitationContent(schema, { port: ["8080"] })).toThrow();
  expect(() =>
    elicitationContent(schema, { port: ["8080"], confirm: ["true"], tags: ["unlisted"] }),
  ).toThrow();
});
