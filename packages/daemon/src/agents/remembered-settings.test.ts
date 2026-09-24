import { expect, it } from "vitest";
import type { AgentInfo } from "@concors/protocol";
import { initialSettings, supportedSettings } from "./remembered-settings.ts";

const codex: Pick<
  AgentInfo,
  "engine" | "provider" | "model" | "models" | "controls" | "supportsPlan"
> = {
  provider: "codex",
  engine: "codex",
  model: "gpt",
  supportsPlan: true,
  models: [
    {
      id: "gpt",
      label: "GPT",
      efforts: ["low", "high"],
      defaultEffort: "low",
      serviceTiers: [{ id: "fast", label: "Fast", description: "" }],
    },
    { id: "mini", label: "Mini", efforts: [], defaultEffort: null },
  ],
};

it("starts from the remembered choices without carrying plan mode into a new chat", () => {
  expect(initialSettings(null)).toEqual({ model: null, effort: null, mode: "default" });
  expect(
    initialSettings({ model: "gpt", effort: "high", mode: "full-access", planMode: true }),
  ).toEqual({ model: "gpt", effort: "high", mode: "full-access" });
});

it("lets an explicitly chosen model replace the choices that belonged to the remembered one", () => {
  const remembered = {
    model: "gpt",
    effort: "high",
    mode: "full-access" as const,
    serviceTier: "fast",
    features: { thinking: true },
  };
  expect(initialSettings(remembered, "gpt")).toEqual(remembered);
  expect(initialSettings(remembered, "mini")).toEqual({
    model: "mini",
    effort: null,
    mode: "full-access",
    serviceTier: null,
    features: {},
  });
});

it("drops remembered choices the provider no longer offers", () => {
  expect(
    supportedSettings(
      { model: "retired", effort: "high", mode: "full-access", serviceTier: "fast" },
      codex,
    ),
  ).toEqual({ model: null, effort: "high", mode: "full-access", serviceTier: "fast" });
  expect(supportedSettings({ model: "mini", effort: "high", mode: "default" }, codex)).toEqual({
    model: "mini",
    effort: null,
    mode: "default",
  });
  expect(
    supportedSettings(
      {
        model: null,
        effort: "high",
        mode: "full-access",
        serviceTier: "fast",
        nativeMode: "bypassPermissions",
        features: { thinking: true, fast: "on" },
      },
      {
        provider: "claude",
        engine: "claude",
        model: "opus",
        models: [{ id: "opus", label: "Opus", efforts: ["high"], defaultEffort: null }],
        controls: {
          modes: [{ id: "bypassPermissions", label: "Bypass" }],
          currentMode: "default",
          commands: [],
          features: [{ id: "thinking", label: "Thinking", value: false }],
          compact: false,
          contextUsage: false,
          steer: false,
          rewind: [],
          fork: false,
          childHistory: false,
          importSessions: false,
          history: false,
          mcpStatus: false,
          mcp: false,
        },
      },
    ),
  ).toEqual({
    model: null,
    effort: "high",
    mode: "default",
    serviceTier: null,
    nativeMode: "bypassPermissions",
    features: { thinking: true },
  });
});
