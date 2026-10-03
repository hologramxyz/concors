import { expect, it } from "vitest";
import { agentInstructions } from "./instructions.ts";

it("tells agents how to detach a dev server with the tools their system has", () => {
  for (const platform of ["linux", "darwin"] as const) {
    const text = agentInstructions(platform);
    expect(text).toContain("setsid nohup pnpm dev --host 127.0.0.1 > /tmp/dev-5173.log");
    expect(text).not.toContain("Start-Process");
  }
  const windows = agentInstructions("win32");
  expect(windows).toContain(
    'Start-Process pnpm -ArgumentList "dev --host 127.0.0.1" -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\\dev-5173.log"',
  );
  expect(windows).toContain('$env:CONCORS_PREVIEW_NAME = "Landing site"');
  expect(windows).not.toMatch(/setsid|nohup|\/dev\/null|\/tmp\/dev/);
  // Everything but the command is the same advice.
  expect(windows).toContain("listening on 127.0.0.1");
  expect(windows).toContain("[the preview](http://localhost:5173/pricing)");
});
