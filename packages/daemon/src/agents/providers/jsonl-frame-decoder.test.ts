import { expect, it } from "vitest";
import { JsonlFrameDecoder } from "./jsonl-frame-decoder.ts";

it("delivers an unchunked multi-megabyte line, and still refuses one past the limit", () => {
  const frames: Record<string, unknown>[] = [];
  const decoder = new JsonlFrameDecoder({
    frame: (message) => frames.push(message),
    problem: (problem) => {
      throw new Error(problem);
    },
  });
  // A provider that does not split messages into protocol v2 chunks sends them as one line.
  const line = JSON.stringify({ type: "message", text: "x".repeat(3 * 1024 * 1024) }) + "\r\n";
  for (let at = 0; at < line.length; at += 64 * 1024) decoder.write(line.slice(at, at + 64 * 1024));
  expect(frames).toHaveLength(1);
  expect((frames[0]!["text"] as string).length).toBe(3 * 1024 * 1024);
  expect(() => decoder.write("y".repeat(64 * 1024 * 1024 + 1))).toThrow("Provider frame too large");
});
