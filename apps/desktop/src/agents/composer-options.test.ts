import { describe, expect, it } from "vitest";
import { AgentControlsSchema } from "@concors/protocol";
import { hasComposerOptions } from "./composer-options";

const controls = (over: object) => AgentControlsSchema.parse({ modes: [], features: [], ...over });
const other = { provider: "opencode", engine: "opencode" } as const;

describe("hasComposerOptions", () => {
  it("is always true for Codex, which has permissions", () => {
    expect(hasComposerOptions({ provider: "codex" }, null)).toBe(true);
  });
  it("is false only when a provider offers nothing at all", () => {
    expect(hasComposerOptions(other, { efforts: [] })).toBe(false);
    expect(hasComposerOptions({ ...other, controls: controls({}) }, null)).toBe(false);
  });
  it("counts effort, modes, features and plan mode", () => {
    expect(hasComposerOptions(other, { efforts: ["low"] })).toBe(true);
    expect(hasComposerOptions({ ...other, supportsPlan: true }, null)).toBe(true);
    expect(
      hasComposerOptions(
        { ...other, controls: controls({ modes: [{ id: "build", label: "Build" }] }) },
        null,
      ),
    ).toBe(true);
    expect(
      hasComposerOptions(
        {
          ...other,
          controls: controls({ features: [{ id: "fast_mode", label: "Fast", value: false }] }),
        },
        null,
      ),
    ).toBe(true);
  });
});
