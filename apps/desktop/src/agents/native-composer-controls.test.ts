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
  const providerRow = {
    id: "model:providers",
    label: "Provider",
    value: "Codex",
    selected: false,
    navigate: true,
    section: true,
  };
  it("titles the sheet with its provider and ends in a row that opens Providers", () => {
    const menu = control(build(), "model");
    expect(menu).toMatchObject({ label: "Agent and model", title: "Codex" });
    expect(menu?.options?.at(-1)).toEqual(providerRow);
    expect(rows(build(), "model")).toEqual(["✓ GPT-5", "Provider"]);
    expect(control(build(), "model:older")).toBeUndefined();
  });
  const models = [model("gpt-5.1", "GPT-5.1"), model("gpt-5.5", "GPT-5.5")];
  const page = { ...codex, models };
  it("moves older models to a page of their own, behind a row beside the current ones", () => {
    const controls = build({ page, selection: { value: "gpt-5.5", options: models } });
    expect(rows(controls, "model")).toEqual(["✓ GPT-5.5", "Older models", "Provider"]);
    expect(control(controls, "model")?.options?.[1]).toEqual({
      id: "model:older",
      label: "Older models",
      selected: false,
      navigate: true,
    });
    expect(control(controls, "model:older")?.title).toBe("Older models");
    expect(rows(controls, "model:older")).toEqual(["GPT-5.1"]);
  });
  it("says on the first page when the current model is an older one", () => {
    const controls = build({ page, selection: { value: "gpt-5.1", options: models } });
    expect(control(controls, "model")?.options?.[1]?.value).toBe("GPT-5.1");
    expect(rows(controls, "model:older")).toEqual(["✓ GPT-5.1"]);
  });
  it("closes the sheet for an older model of another provider, whose switch asks first", () => {
    const same = build({ page, selection: { value: "gpt-5.5", options: models } });
    expect(control(same, "model:older")?.options?.[0]?.closes).toBeUndefined();
    const other = { id: "other", label: "Other", models };
    const controls = build({ page: other, providers: [codex, other] });
    expect(control(controls, "model:older")?.options?.[0]?.closes).toBe(true);
    // Nothing of another provider is the current model, even with the same ID.
    expect(rows(controls, "model")).toEqual(["GPT-5.5", "Older models", "Provider"]);
  });
  it("lists providers by name on their page, with only a state worth noting as a second line", () => {
    const controls = build({
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
    expect(control(controls, "model:providers")?.title).toBe("Providers");
    expect(control(controls, "model:providers")?.options).toEqual([
      { id: "codex", label: "Codex", selected: true },
      { id: "claude", label: "Claude Code", selected: false, description: "Not installed" },
      { id: "opencode", label: "OpenCode", selected: false, description: "Update available" },
    ]);
  });
  it("keeps the check on the provider in use while browsing another", () => {
    const claude = { id: "claude", label: "Claude Code", models: [model("sonnet", "Sonnet")] };
    const controls = build({ page: claude, providers: [codex, claude] });
    expect(control(controls, "model")?.title).toBe("Claude Code");
    expect(control(controls, "model")?.options?.at(-1)?.value).toBe("Claude Code");
    expect(rows(controls, "model:providers")).toEqual(["✓ Codex", "Claude Code"]);
  });
  it("still offers Providers before the catalog has an entry for the agent's provider", () => {
    const controls = build({ page: undefined, providers: [] });
    expect(control(controls, "model")?.title).toBe("Codex");
    expect(rows(controls, "model")).toEqual(["Provider"]);
  });
  it("offers an install or a sign-in on a provider with no models", () => {
    const page = { id: "claude", label: "Claude Code", models: [], installed: false };
    expect(rows(build({ page }), "model")).toEqual(["Install Claude Code", "Provider"]);
    expect(rows(build({ page: { ...page, installed: true } }), "model")).toEqual([
      "Use Claude Code",
      "Provider",
    ]);
  });
  it("puts an update or sign-in in a group of its own above Provider", () => {
    const footer = [{ id: "__update__", label: "Update", selected: false, section: true }];
    const options = control(build({ footer }), "model")?.options;
    expect(options?.map((option) => [option.label, !!option.section])).toEqual([
      ["GPT-5", false],
      ["Update", true],
      ["Provider", true],
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
  it("words the update and the sign-in as desktop does, starting a group", () => {
    expect(footer({ version, account: { status: "disconnected" } as never })).toEqual([
      {
        id: "__update__",
        label: "Update to 1.2.3",
        selected: false,
        navigate: true,
        disabled: false,
        section: true,
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
  const valueRows = (controls: ReturnType<typeof build>) =>
    control(controls, "options")?.options?.map((option) =>
      option.toggle
        ? `${option.label}: ${option.selected ? "on" : "off"}`
        : `${option.label}: ${option.value} ›`,
    );
  it("lists what each page is set to, then switches in a group below for Codex", () => {
    const controls = build();
    expect(control(controls, "options")).toMatchObject({
      label: "More composer options",
      title: "Options",
    });
    expect(valueRows(controls)).toEqual([
      "Thinking effort: High ›",
      "Permission mode: Auto-review ›",
      "Speed: Default ›",
      "Plan mode: off",
    ]);
    expect(control(controls, "options")?.options?.[0]).toMatchObject({
      id: "effort",
      navigate: true,
    });
    expect(control(controls, "options")?.options?.at(-1)).toMatchObject({
      id: "plan",
      section: true,
    });
  });
  it("names effort as desktop does, with a check only on the current one", () => {
    const controls = build();
    expect(control(controls, "effort")).toMatchObject({
      label: "Thinking effort",
      title: "Thinking effort",
    });
    expect(rows(controls, "effort")).toEqual(["Default (medium)", "Low", "Medium", "✓ High"]);
    const unset = build({ settings: { ...settings, effort: null } });
    expect(rows(unset, "effort")?.[0]).toBe("✓ Default (medium)");
    expect(control(unset, "options")?.options?.[0]?.value).toBe("Default (medium)");
  });
  it("names Codex permissions plainly, with desktop's line under each", () => {
    const controls = build();
    expect(control(controls, "mode")?.title).toBe("Permission mode");
    expect(rows(controls, "mode")).toEqual(["Default permissions", "✓ Auto-review", "Full access"]);
    expect(control(controls, "mode")?.options?.map((option) => option.description)).toEqual([
      "Workspace access; asks when approval is needed.",
      "Same sandbox; eligible requests go to the reviewer agent.",
      "File and network access without approval prompts.",
    ]);
  });
  it("names another provider's modes by their labels, under Agent mode", () => {
    const controls = build({
      agent: agent({
        provider: "claude",
        controls: AgentControlsSchema.parse({
          currentMode: "bypassPermissions",
          modes: [
            { id: "default", label: "Default", description: "Asks first" },
            { id: "bypassPermissions", label: "Bypass permissions" },
          ],
          features: [],
        }),
      }),
    });
    expect(control(controls, "mode")?.title).toBe("Agent mode");
    expect(rows(controls, "mode")).toEqual(["Default", "✓ Bypass permissions"]);
    expect(control(controls, "mode")?.options?.[0]?.description).toBe("Asks first");
    expect(valueRows(controls)).toEqual([
      "Thinking effort: High ›",
      "Agent mode: Bypass permissions ›",
      "Plan mode: off",
    ]);
  });
  it("gives Codex's speed a page of tiers, where the default turns the tier off", () => {
    const controls = build();
    expect(control(controls, "speed")?.title).toBe("Speed");
    expect(control(controls, "speed")?.options).toEqual([
      { id: "speed:", label: "Default speed", selected: true },
      { id: "speed:fast", label: "Fast", selected: false },
    ]);
    const fast = build({ settings: { ...settings, serviceTier: "fast" } });
    expect(rows(fast, "speed")).toEqual(["Default speed", "✓ Fast"]);
    expect(control(fast, "options")?.options?.[2]?.value).toBe("Fast");
  });
  it("has no speed row for a model without tiers", () => {
    const controls = build({ effortModel: { efforts: ["low"] } });
    expect(control(controls, "speed")).toBeUndefined();
    expect(rows(controls, "options")).not.toContain("Speed");
  });
  it("shows Plan mode as a switch that is on", () => {
    const on = build({ settings: { ...settings, planMode: true } });
    expect(control(on, "options")?.options?.at(-1)).toEqual({
      id: "plan",
      label: "Plan mode",
      selected: true,
      toggle: true,
      section: true,
    });
  });
  it("words a provider's Fast feature as a switch, and gives other choices their own page", () => {
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
            { id: "memory", label: "Memory", value: false },
          ],
        }),
      }),
    });
    expect(valueRows(controls)).toEqual([
      "Thinking effort: High ›",
      "Style: Brief ›",
      "Fast: on",
      "Memory: off",
    ]);
    expect(control(controls, "options")?.options?.[2]).toMatchObject({
      id: `feature:${JSON.stringify(["fast_mode", false])}`,
      section: true,
      toggle: true,
    });
    expect(control(controls, "options")?.options?.[3]?.id).toBe(
      `feature:${JSON.stringify(["memory", true])}`,
    );
    expect(control(controls, "feature:style")?.title).toBe("Style");
    expect(rows(controls, "feature:style")).toEqual(["✓ Brief", "Long"]);
  });
  it("steps aside when a provider offers nothing", () => {
    const controls = build({
      agent: agent({ provider: "opencode", supportsPlan: false }),
      effortModel: { efforts: [] },
    });
    expect(controls.map((item) => item.id)).toEqual(["model", "model:providers"]);
  });
  it("keeps every row free of a colon description", () => {
    for (const item of build()) {
      expect(item.label).not.toContain(":");
      for (const option of item.options ?? []) expect(option.label).not.toContain(":");
    }
  });
});
