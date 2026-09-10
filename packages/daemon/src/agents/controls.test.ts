import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  AgentOperationSchema,
  AgentProviderCatalogSchema,
  AgentSettingsSchema,
} from "@concors/protocol";
import { parseModels } from "./controls.ts";
import { modelCatalog } from "./providers/contract.ts";

it("keeps every connected account's models beyond the first hundred and allows qualified IDs", () => {
  const longId = "connected-account/" + "model-".repeat(30);
  const native = Array.from({ length: 150 }, (_, i) => ({
    id: i === 149 ? longId : `account/model-${i}`,
    label: `Model ${i}`,
  }));
  const models = parseModels(modelCatalog(native));
  expect(models).toHaveLength(150);
  expect(AgentProviderCatalogSchema.parse({ id: "opencode", models }).models.at(-1)?.id).toBe(
    longId,
  );
  expect(AgentSettingsSchema.parse({ model: longId }).model).toBe(longId);
  expect(
    AgentOperationSchema.parse({
      kind: "switch-provider",
      sessionId: randomUUID(),
      provider: "opencode",
      model: longId,
      expectedRevision: 0,
    }),
  ).toMatchObject({ model: longId });
});

it("reports an oversized provider catalog rather than silently hiding models", () => {
  expect(() =>
    parseModels(
      modelCatalog(Array.from({ length: 4097 }, (_, i) => ({ id: `m${i}`, label: `Model ${i}` }))),
    ),
  ).toThrow("Filter its catalog");
});
