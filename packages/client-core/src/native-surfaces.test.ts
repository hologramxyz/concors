import { expect, it } from "vitest";
import { MAX_AGENT_MODELS } from "@concors/protocol";
import { NativeControlSchema, NativeSurfaceEventSchema } from "./native-surfaces";

it("round-trips a full provider model catalog and long qualified IDs through native controls", () => {
  const modelId = "provider/" + "m".repeat(1015);
  const control = NativeControlSchema.parse({
    id: "model",
    label: "Agent and model",
    icon: "model",
    disabled: false,
    options: [
      { id: "__providers__", label: "Back to providers", selected: false },
      { id: "", label: "Machine default", selected: true },
      ...Array.from({ length: MAX_AGENT_MODELS }, (_, index) => ({
        id: index === 0 ? modelId : `provider/model-${index}`,
        label: `Model ${index}`,
        selected: false,
      })),
    ],
  });
  expect(control.options).toHaveLength(MAX_AGENT_MODELS + 2);
  expect(
    NativeSurfaceEventSchema.parse({ kind: "press", control: "model", value: modelId }),
  ).toMatchObject({ value: modelId });
});

it("preserves native command descriptions and encoded feature choices with explicit bounds", () => {
  const value = `feature:${JSON.stringify(["feature".repeat(18), "\0".repeat(1024)])}`;
  const control = NativeControlSchema.parse({
    id: "options",
    label: "Agent options",
    icon: "options",
    disabled: false,
    options: [{ id: value, label: "Command: " + "description ".repeat(330), selected: false }],
  });
  expect(
    NativeSurfaceEventSchema.parse({
      kind: "press",
      control: "options",
      value: control.options![0]!.id,
    }),
  ).toMatchObject({ value });
  expect(
    NativeSurfaceEventSchema.safeParse({
      kind: "press",
      control: "options",
      value: "x".repeat(8193),
    }).success,
  ).toBe(false);
});
