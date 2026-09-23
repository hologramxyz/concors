import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DictationEvent, DictationOperation, DictationResult } from "@concors/protocol";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ModelStore } from "./model.ts";
import { DictationService } from "./service.ts";

const ID = "4f1c5c2e-8f3b-4a39-9a51-0d6a4f2b7c11";
const REQUEST = "0b8e6f9a-2d4c-4e7b-8a1f-3c5d7e9f1a2b";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "concors-dictation-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function service(ready: boolean) {
  const models = new ModelStore(root, {
    spec: { id: "empty", files: [] },
    fetch: (() => Promise.reject(new Error("offline"))) as typeof fetch,
  });
  const created = new DictationService(root, {
    models,
    transcriber: () => ({ transcribe: async () => "hello there", close: () => undefined }),
    downloadDelayMs: 0,
  });
  return { created, ready: ready ? models.ensure() : Promise.resolve() };
}
const request = (operation: DictationOperation) =>
  ({ type: "dictation.request", requestId: REQUEST, operation }) as const;
const tone = Buffer.alloc(16_000 * 2);
for (let i = 0; i < 16_000; i++) tone.writeInt16LE(Math.round(8000 * Math.sin(i / 10)), i * 2);

it("explains that dictation is still getting ready and starts the download", () => {
  const { created } = service(false);
  const result = created.request(
    "viewer",
    request({ kind: "start", dictationId: ID }),
    () => undefined,
  );
  expect(result.outcome).toMatchObject({ status: "error" });
  expect((result.outcome as { message: string }).message).toContain("getting ready");
  created.close();
});

it("records, transcribes and ends a dictation for its own connection only", async () => {
  const { created, ready } = service(true);
  await ready;
  const events: DictationEvent[] = [];
  const results: DictationResult[] = [
    created.request("viewer", request({ kind: "start", dictationId: ID }), (event) =>
      events.push(event),
    ),
  ];
  expect(results[0]!.outcome).toEqual({ status: "ok", model: { state: "ready" } });
  created.audio("intruder", { type: "dictation.audio", dictationId: ID, seq: 0, pcm: "AAAA" });
  created.audio("viewer", {
    type: "dictation.audio",
    dictationId: ID,
    seq: 0,
    pcm: tone.toString("base64"),
  });
  expect(
    created.request("intruder", request({ kind: "finish", dictationId: ID }), () => undefined)
      .outcome,
  ).toMatchObject({ status: "error" });
  created.request("viewer", request({ kind: "finish", dictationId: ID }), () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events.at(-1)).toEqual({
    type: "dictation.transcript",
    dictationId: ID,
    text: "hello there",
    final: true,
  });
  expect(
    created.request("viewer", request({ kind: "finish", dictationId: ID }), () => undefined)
      .outcome,
  ).toMatchObject({ status: "error" });
  created.close();
});

it("drops recordings when their connection closes", async () => {
  const { created, ready } = service(true);
  await ready;
  const events: DictationEvent[] = [];
  created.request("viewer", request({ kind: "start", dictationId: ID }), (event) =>
    events.push(event),
  );
  created.detach("viewer");
  created.request("viewer", request({ kind: "finish", dictationId: ID }), () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toEqual([]);
  created.close();
});
