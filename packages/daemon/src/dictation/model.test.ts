import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DictationModel } from "@concors/protocol";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ModelStore, type ModelSpec } from "./model.ts";

const contents = { "a.onnx": Buffer.from("encoder weights"), "tokens.txt": Buffer.from("x 1\n") };
const spec: ModelSpec = {
  id: "fixture",
  files: Object.entries(contents).map(([name, bytes]) => ({
    name,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })),
};
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "concors-model-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function serve(body: (name: string) => Buffer | null, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request) => {
    const name = String(url).split("/").pop()!;
    calls.push(name);
    const bytes = body(name);
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
  }) as typeof fetch;
}

it("downloads, verifies and then reuses the model without fetching again", async () => {
  const calls: string[] = [];
  const states: DictationModel["state"][] = [];
  const store = new ModelStore(root, {
    spec,
    url: (file) => `https://models.test/${file}`,
    fetch: serve((name) => contents[name as keyof typeof contents] ?? null, calls),
  });
  store.onChange((model) => states.push(model.state));
  await store.ensure();
  expect(store.state).toEqual({ state: "ready" });
  expect(states[0]).toBe("downloading");
  expect(await readFile(store.path("a.onnx"), "utf8")).toBe("encoder weights");
  expect((await readdir(store.directory)).filter((file) => file.endsWith(".partial"))).toEqual([]);

  const again = new ModelStore(root, { spec, fetch: serve(() => null, calls) });
  expect(await again.check()).toBe(true);
  expect(again.state).toEqual({ state: "ready" });
  expect(calls).toEqual(["a.onnx", "tokens.txt"]);
});

it("rejects a file whose hash does not match and retries later", async () => {
  let tampered = true;
  const store = new ModelStore(root, {
    spec,
    retryAfterMs: 10,
    fetch: serve((name) =>
      name === "a.onnx" && tampered
        ? Buffer.from("encoder weightz")
        : (contents[name as keyof typeof contents] ?? null),
    ),
  });
  await store.ensure();
  expect(store.state).toMatchObject({ state: "failed" });
  expect(store.state.state === "failed" && store.state.message).toContain("failed verification");
  await expect(readFile(store.path("a.onnx"))).rejects.toThrow();

  tampered = false;
  const ready = new Promise<void>((resolve) =>
    store.onChange((model) => model.state === "ready" && resolve()),
  );
  await ready;
  store.close();
});

it("reports HTTP failures without leaving a ready marker", async () => {
  const store = new ModelStore(root, { spec, fetch: serve(() => null) });
  expect(await store.check()).toBe(false);
  await store.ensure();
  store.close();
  expect(store.state).toMatchObject({ state: "failed" });
  expect(store.state.state === "failed" && store.state.message).toContain("HTTP 404");
  await expect(readFile(store.path("ready"))).rejects.toThrow();
});
