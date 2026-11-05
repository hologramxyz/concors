import { describe, expect, it } from "vitest";
import { AgentControlsSchema, type AgentInfo, type AgentSettings } from "@concors/protocol";
import { modelMenuFooter, nativeComposerControls } from "./native-composer-controls";

const agent = (patch: Partial<AgentInfo> = {}) =>
  ({ id: "a", provider: "codex", supportsPlan: true, ...patch }) as AgentInfo;
const settings: AgentSettings = { model: "gpt-5", effort: "high", mode: "auto-review" };
const model = (id: string, label: string) => ({ id, label, efforts: [], defaultEffort: null });
const codex = { id: "codex", label: "Codex", models: [model("gpt-5", "GPT-5")] };
const build = (over: Partial<Parameters<typeof nativeComposerControls>[0]> = {}) =>
  nativeComposerControls({
    agent: agent(),
    settings,
    effortModel: {
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
      serviceTiers: [{ id: "fast", label: "Fast" }],
    },
    disabled: false,
    modelDisabled: false,
    providers: [codex],
    page: codex,
    selection: { value: "gpt-5", options: codex.models },
    footer: [],
    ...over,
  });
const control = (controls: ReturnType<typeof build>, id: string) =>
  controls.find((item) => item.id === id);
const rows = (controls: ReturnType<typeof build>, id: string) =>
  control(controls, id)?.options?.map((option) =>
    option.selected ? `✓ ${option.label}` : option.label,
  );

describe("the model menu", () => {
  it("titles a model page with its provider and goes back to Providers first", () => {
    const menu = control(build(), "model");
    expect(menu).toMatchObject({ label: "Agent and model", title: "Codex" });
    expect(menu?.options?.[0]).toEqual({
      id: "__providers__",
      label: "← Providers",
      selected: false,
      navigate: true,
    });
    expect(rows(build(), "model")).toEqual(["← Providers", "✓ GPT-5"]);
  });
  it("puts older models below current ones, starting a section", () => {
    const models = [model("gpt-5.1", "GPT-5.1"), model("gpt-5.5", "GPT-5.5")];
    const page = { ...codex, models };
    const options = control(
      build({ page, selection: { value: "gpt-5.5", options: models } }),
      "model",
    )?.options;
    expect(options?.map((option) => [option.label, !!option.divider])).toEqual([
      ["← Providers", false],
      ["GPT-5.5", false],
      ["GPT-5.1", true],
    ]);
  });
  it("lists providers by name, with only a state worth noting as a second line", () => {
    const controls = build({
      page: undefined,
      providers: [
        codex,
        { id: "claude", label: "Claude Code", models: [], installed: false },
        {
          id: "opencode",
          label: "OpenCode",
          models: [],
          version: { updateAvailable: true, installed: "1", latest: "2" },
        },
      ],
    });
    expect(control(controls, "model")?.title).toBe("Providers");
    expect(control(controls, "model")?.options).toEqual([
      { id: "codex", label: "Codex", selected: true, navigate: true },
      {
        id: "claude",
        label: "Claude Code",
        selected: false,
        navigate: true,
        description: "Not installed",
      },
      {
        id: "opencode",
        label: "OpenCode",
        selected: false,
        navigate: true,
        description: "Update available",
      },
    ]);
  });
  it("offers an install or a sign-in on a provider with no models", () => {
    const page = { id: "claude", label: "Claude Code", models: [], installed: false };
    expect(rows(build({ page }), "model")).toEqual(["← Providers", "Install Claude Code"]);
    expect(rows(build({ page: { ...page, installed: true } }), "model")).toEqual([
      "← Providers",
      "Use Claude Code",
    ]);
  });
});

describe("the model menu's footer", () => {
  const footer = (over: Partial<Parameters<typeof modelMenuFooter>[0]> = {}) =>
    modelMenuFooter({
      provider: codex,
      version: undefined,
      error: null,
      guide: undefined,
      account: undefined,
      accountName: "ChatGPT",
      ...over,
    });
  const version = { updateAvailable: true, latest: "1.2.3", updateCommand: "npm i" };
  it("is empty without an update or a missing sign-in", () => {
    expect(footer()).toEqual([]);
    expect(footer({ account: { status: "connected" } as never })).toEqual([]);
  });
  it("words the update and the sign-in as desktop does, starting a section", () => {
    expect(footer({ version, account: { status: "disconnected" } as never })).toEqual([
      {
        id: "__update__",
        label: "Update to 1.2.3",
        selected: false,
        navigate: true,
        disabled: false,
        divider: true,
      },
      { id: "__connect__", label: "Connect ChatGPT account", selected: false },
    ]);
  });
  it("shows an update in progress, and says how when the machine can't run one", () => {
    expect(footer({ version: { ...version, updating: true } })[0]).toMatchObject({
      label: "Updating Codex…",
      disabled: true,
    });
    const manual = { updateAvailable: true, latest: "1.2.3" };
    expect(footer({ version: manual })[0]).toMatchObject({
      disabled: true,
      description: "Update it the way you installed it.",
    });
    expect(footer({ version: manual, guide: "https://example.com" })[0]).toMatchObject({
      disabled: false,
    });
  });
  it("doesn't offer an account on a provider that isn't installed", () => {
    expect(
      footer({
        provider: { ...codex, installed: false },
        account: { status: "disconnected" } as never,
      }),
    ).toEqual([]);
  });
});

describe("the options sheet", () => {
  it("leads to effort and permissions, with plain rows for Codex", () => {
    const controls = build();
    expect(control(controls, "options")?.title).toBeUndefined();
    expect(rows(controls, "options")).toEqual([
      "Thinking effort",
      "Permission mode",
      "Plan mode",
      "Fast",
    ]);
    expect(control(controls, "options")?.options?.[0]).toMatchObject({
      id: "effort",
      navigate: true,
    });
  });
  it("names effort as desktop does, with a check only on the current one", () => {
    const controls = build();
    expect(control(controls, "effort")).toMatchObject({
      label: "Thinking effort",
      title: "Thinking effort",
    });
    expect(rows(controls, "effort")).toEqual(["Default (medium)", "Low", "Medium", "✓ High"]);
  });
  it("names Codex permissions plainly", () => {
    const controls = build();
    expect(control(controls, "mode")?.title).toBe("Permission mode");
    expect(rows(controls, "mode")).toEqual(["Default permissions", "✓ Auto-review", "Full access"]);
  });
  it("names another provider's modes by their labels, under Agent mode", () => {
    const controls = build({
      agent: agent({
        provider: "claude",
        controls: AgentControlsSchema.parse({
          currentMode: "bypassPermissions",
          modes: [
            { id: "default", label: "Default" },
            { id: "bypassPermissions", label: "Bypass permissions" },
          ],
          features: [],
        }),
      }),
    });
    expect(control(controls, "mode")?.title).toBe("Agent mode");
    expect(rows(controls, "mode")).toEqual(["Default", "✓ Bypass permissions"]);
    expect(rows(controls, "options")).toEqual(["Thinking effort", "Agent mode", "Plan mode"]);
  });
  it("checks Plan mode and Fast when on, and pressing Fast again turns it off", () => {
    const on = build({ settings: { ...settings, planMode: true, serviceTier: "fast" } });
    expect(rows(on, "options")).toEqual([
      "Thinking effort",
      "Permission mode",
      "✓ Plan mode",
      "✓ Fast",
    ]);
    expect(control(on, "options")?.options?.at(-1)?.id).toBe("speed:");
    expect(control(build(), "options")?.options?.at(-1)?.id).toBe("speed:fast");
  });
  it("words a provider's Fast feature the same, and gives other features their own page", () => {
    const controls = build({
      agent: agent({
        provider: "claude",
        supportsPlan: false,
        controls: AgentControlsSchema.parse({
          modes: [],
          features: [
            { id: "fast_mode", label: "Fast mode", value: true },
            {
              id: "style",
              label: "Style",
              value: "brief",
              options: [
                { id: "brief", label: "Brief" },
                { id: "long", label: "Long" },
              ],
            },
          ],
        }),
      }),
    });
    expect(rows(controls, "options")).toEqual(["Thinking effort", "✓ Fast", "Style"]);
    expect(control(controls, "options")?.options?.[1]?.id).toBe(
      `feature:${JSON.stringify(["fast_mode", false])}`,
    );
    expect(control(controls, "feature:style")?.title).toBe("Style");
    expect(rows(controls, "feature:style")).toEqual(["✓ Brief", "Long"]);
  });
  it("steps aside when a provider offers nothing", () => {
    const controls = build({
      agent: agent({ provider: "opencode", supportsPlan: false }),
      effortModel: { efforts: [] },
    });
    expect(controls.map((item) => item.id)).toEqual(["model"]);
  });
  it("keeps every row free of a colon description", () => {
    for (const item of build()) {
      expect(item.label).not.toContain(":");
      for (const option of item.options ?? []) expect(option.label).not.toContain(":");
    }
  });
});
