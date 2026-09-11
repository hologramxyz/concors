import { expect, it } from "vitest";
import {
  AgentInfoSchema,
  agentModelName,
  agentModelSelection,
  findAgentModel,
} from "@concors/protocol";
import { parseModels } from "./controls.ts";
import { modelCatalog } from "./providers/contract.ts";
import { randomUUID } from "node:crypto";

const models = parseModels(
  modelCatalog([
    {
      id: "default",
      label: "Default (recommended)",
      resolvedModel: "claude-opus-5-1",
      isDefault: true,
    },
    { id: "sonnet", label: "Sonnet 5", resolvedModel: "claude-sonnet-5" },
  ]),
);
const agent = AgentInfoSchema.parse({
  id: randomUUID(),
  projectId: randomUUID(),
  provider: "claude",
  name: "Agent",
  directory: "/tmp",
  model: "claude-opus-5-1",
  models,
  threadId: "thread",
  turnId: null,
  status: "idle",
  error: null,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  turnStartedAt: null,
  revision: 0,
  pending: [],
});

it("preserves resolved IDs and default metadata from provider catalogs", () => {
  expect(models[0]).toMatchObject({ resolvedModel: "claude-opus-5-1", isDefault: true });
  expect(agentModelName(models[0]!, models)).toBe("Opus 5.1");
});
it("shows the effective named model for automatic settings and explicit alias selections", () => {
  expect(agentModelSelection(agent)).toEqual({ value: "default", label: "Opus 5.1" });
  expect(
    agentModelSelection({ ...agent, settings: { model: "sonnet", mode: "default", effort: null } }),
  ).toEqual({ value: "sonnet", label: "Sonnet 5" });
});
it("never guesses a model when the provider has not reported one", () => {
  expect(agentModelSelection({ ...agent, model: null, models: [] }).label).toBe(
    "Model not reported",
  );
  expect(
    agentModelSelection({ ...agent, model: "own-account/custom-model", models: [] }).label,
  ).toBe("own-account/custom-model");
});
it("matches alias capabilities and uses the actual model with legacy default rows", () => {
  expect(findAgentModel(models, "claude-sonnet-5")?.id).toBe("sonnet");
  const legacy = [{ id: "default", label: "Default", efforts: [], defaultEffort: null }];
  expect(
    agentModelSelection({
      ...agent,
      models: legacy,
      settings: { model: "default", mode: "default", effort: null },
    }).label,
  ).toBe("Opus 5.1");
});
it("names the alias/version/context combinations reported by the installed Claude CLI", () => {
  const captured = parseModels(
    modelCatalog([
      { id: "default", label: "Default (recommended)", resolvedModel: "claude-opus-5[1m]" },
      { id: "opus[1m]", label: "Opus (1M context)", resolvedModel: "claude-opus-5[1m]" },
      { id: "claude-fable-5[1m]", label: "Fable", resolvedModel: "claude-fable-5" },
      { id: "sonnet", label: "Sonnet", resolvedModel: "claude-sonnet-5" },
      { id: "haiku", label: "Haiku", resolvedModel: "claude-haiku-4-5-20251001" },
    ]),
  );
  expect(captured.map((m) => agentModelName(m, captured))).toEqual([
    "Opus 5 (1M context)",
    "Opus 5 (1M context)",
    "Fable 5",
    "Sonnet 5",
    "Haiku 4.5",
  ]);
});
