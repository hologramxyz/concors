import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it } from "vitest";
import { useAISharingPrompt } from "./use-ai-sharing-prompt";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer | undefined;
let current: ReturnType<typeof useAISharingPrompt>;
const disclosure = { summary: "Share with Anthropic?", details: "Prompts and code." };
function Probe({ connection }: { connection: string | null }) {
  const value = useAISharingPrompt(connection);
  useEffect(() => {
    current = value;
  }, [value]);
  return null;
}
async function mount(connection: string | null) {
  await act(async () => {
    const element = createElement(Probe, { connection });
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

it("resolves only the current prompt's explicit answer", async () => {
  await mount("first");
  let reply!: Promise<boolean>;
  await act(async () => {
    reply = current.ask(disclosure);
  });
  expect(current.prompt?.disclosure).toEqual(disclosure);
  await act(async () => current.answer(current.prompt!.id, true));
  await expect(reply).resolves.toBe(true);
  expect(current.prompt).toBeNull();
});

it("denies an abandoned connection and ignores its late reply after reconnecting", async () => {
  await mount("first");
  let first!: Promise<boolean>;
  await act(async () => {
    first = current.ask(disclosure);
  });
  const abandoned = current.prompt!.id;
  await mount("second");
  await expect(first).resolves.toBe(false);
  expect(current.prompt).toBeNull();
  let next!: Promise<boolean>;
  await act(async () => {
    next = current.ask(disclosure);
  });
  const active = current.prompt!.id;
  await act(async () => current.answer(abandoned, true));
  expect(current.prompt?.id).toBe(active);
  await act(async () => current.answer(active, false));
  await expect(next).resolves.toBe(false);
});

it("denies a pending request when its workspace unmounts", async () => {
  await mount("first");
  let reply!: Promise<boolean>;
  await act(async () => {
    reply = current.ask(disclosure);
  });
  await act(async () => renderer!.unmount());
  renderer = undefined;
  await expect(reply).resolves.toBe(false);
});
