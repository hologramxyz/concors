import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { providerPresets } from "../../packages/protocol/src/provider-presets.ts";

/**
 * Turns on presets that are off by default, as saving them enabled on the machine would. The
 * fixtures keep exercising those adapters even though a fresh machine only offers Codex, Claude
 * Code and OpenCode.
 */
export function enableProviders(directory: string, ids: readonly string[]) {
  const providers = ids.map((id) => {
    const preset = providerPresets.find((p) => p.id === id);
    if (!preset) throw new Error(`Unknown provider preset: ${id}`);
    return { ...preset, enabled: true };
  });
  mkdirSync(join(directory, "providers"), { recursive: true });
  writeFileSync(
    join(directory, "providers", "config.json"),
    JSON.stringify({ revision: 1, providers, active: {} }),
  );
}
