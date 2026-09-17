import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it.each(["0", "1"])("honors EXPO_NO_DOTENV=%s in development module discovery", (isolated) => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `
    const { resolver } = require('./metro.config.cjs');
    const rules = [resolver.blockList].flat().filter(Boolean);
    const blocked = path => rules.some(rule => rule.test(path));
    console.log(JSON.stringify({
      local: blocked(process.cwd() + '/.env.local'),
      development: blocked(process.cwd() + '/.env.development'),
      source: blocked(process.cwd() + '/src/config.ts'),
    }));
  `,
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, EXPO_NO_DOTENV: isolated },
      encoding: "utf8",
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    local: isolated === "1",
    development: isolated === "1",
    source: false,
  });
});
