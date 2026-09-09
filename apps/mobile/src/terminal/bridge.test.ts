import { describe, expect, it } from "vitest";
import { parseRendererEvent, rendererScript } from "./bridge";
describe("isolated terminal renderer bridge", () => {
  it("validates bounded input and dimensions", () => {
    expect(parseRendererEvent('{"type":"input","data":"ls\\r"}')).toEqual({
      type: "input",
      data: "ls\r",
    });
    expect(parseRendererEvent({ type: "resize", cols: 1, rows: 999 })).toBeNull();
    expect(parseRendererEvent({ type: "input", data: "x".repeat(16385) })).toBeNull();
    expect(parseRendererEvent("invalid json")).toBeNull();
  });
  it("never interprets terminal output as injected code", () => {
    const command = {
      type: "write" as const,
      data: '");globalThis.compromised=true;//\n</script>',
    };
    const received: unknown[] = [];
    // Execute the bridge script against a fake receiver to prove output remains literal data.
    new Function("window", rendererScript(command))({
      ConcorsTerminal: { receive: (data: unknown) => received.push(data) },
    });
    expect(received).toEqual([command]);
  });
});
