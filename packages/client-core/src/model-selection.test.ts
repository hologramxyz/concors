import { expect, it } from "vitest";
import { modelMenu, modelOptions, modelSelection } from "./model-selection.ts";
const model = (id: string, label: string, resolvedModel?: string, isDefault?: boolean) => ({
  id,
  label,
  efforts: [],
  defaultEffort: null,
  ...(resolvedModel ? { resolvedModel } : {}),
  ...(isDefault === undefined ? {} : { isDefault }),
});
it("selects the session's effective Codex model when no override was saved", () => {
  const models = [model("gpt-6-astra", "GPT-6 Astra")];
  expect(modelSelection({ model: "gpt-6-astra" }, models)).toMatchObject({
    value: "gpt-6-astra",
    label: "GPT-6 Astra",
  });
});
it("keeps explicit overrides and current models absent from a refreshed catalog visible", () => {
  const result = modelSelection(
    { model: "old", settings: { model: "custom/account-model", effort: null, mode: "default" } },
    [],
  );
  expect(result).toMatchObject({
    value: "custom/account-model",
    label: "custom/account-model",
    options: [{ id: "custom/account-model" }],
  });
});
it("retains legacy default bindings while displaying the reported session model", () => {
  expect(
    modelSelection(
      { model: "claude-opus-5", settings: { model: "default", effort: null, mode: "default" } },
      [model("default", "Default")],
    ),
  ).toMatchObject({
    value: "default",
    label: "Opus 5",
    options: [{ id: "default", label: "Opus 5" }],
  });
});
it("shows advertised Claude versions and collapses a duplicate recommendation", () => {
  const models = [
    model("default", "Default (recommended)", "claude-opus-5[1m]", true),
    model("opus[1m]", "Opus (1M context)", "claude-opus-5[1m]"),
    model("fable", "Fable", "claude-fable-5-1"),
    model("claude-fable-5", "Fable", "claude-fable-5"),
    model("haiku", "Haiku", "claude-haiku-4-5-20251001"),
  ];
  expect(modelOptions(models).map((m) => m.label)).toEqual([
    "Opus 5 (1M context)",
    "Fable 5.1",
    "Fable 5",
    "Haiku 4.5",
  ]);
  for (const selected of [null, "default", "opus[1m]", "claude-opus-5[1m]"])
    expect(modelSelection({ model: selected }, models)).toMatchObject({
      value: "opus[1m]",
      label: "Opus 5 (1M context)",
    });
});
it("retains special aliases and deployment labels, without inventing unavailable models", () => {
  const models = [
    model("opusplan", "Opus Plan", "claude-opus-5"),
    model("deployment", "Company gateway", "claude-opus-5"),
  ];
  expect(modelOptions(models).map((m) => m.label)).toEqual(["Opus Plan", "Company gateway"]);
  expect(modelSelection({ model: null }, models).label).toBe("Select model");
});

it("lists each family's newest models first and the older ones after, by family", () => {
  const model = (id: string, label = id) => ({
    id,
    label,
    resolvedModel: id,
    efforts: [],
    defaultEffort: null,
  });
  const menu = modelMenu([
    model("claude-opus-5-5"),
    model("claude-fable-5-1"),
    model("claude-sonnet-5-5"),
    model("claude-haiku-5-5"),
    model("claude-haiku-4-5-20251001"),
    model("claude-sonnet-5"),
    model("claude-opus-5"),
    model("claude-fable-5"),
    model("claude-opus-4-8"),
    model("claude-opus-4-6"),
    model("claude-opus-4-7"),
    model("claude-sonnet-4-6"),
  ]);
  expect(menu.filter((m) => !m.older).map((m) => m.id)).toEqual([
    "claude-opus-5-5",
    "claude-fable-5-1",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
  ]);
  expect(menu.filter((m) => m.older).map((m) => m.id)).toEqual([
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-fable-5",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ]);
  // Current ones first in the array too, so the divider has one place to go.
  expect(menu.findLastIndex((m) => !m.older)).toBeLessThan(menu.findIndex((m) => m.older));
});

it("keeps models without a version, and variants of the newest, with the current ones", () => {
  const model = (id: string) => ({ id, label: id, efforts: [], defaultEffort: null });
  const menu = modelMenu([
    model("gpt-5.2"),
    model("gpt-5.5"),
    model("gpt-5.5-codex"),
    model("gpt-5.2-codex"),
    model("fixture"),
    model("claude-sonnet-5-5[1m]"),
    model("claude-sonnet-5-5"),
  ]);
  expect(menu.map((m) => [m.id, m.older])).toEqual([
    ["gpt-5.5", false],
    ["gpt-5.5-codex", false],
    ["fixture", false],
    ["claude-sonnet-5-5[1m]", false],
    ["claude-sonnet-5-5", false],
    ["gpt-5.2", true],
    ["gpt-5.2-codex", true],
  ]);
});
