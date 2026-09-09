import { spawn } from "node:child_process";

const child = spawn(
  "pnpm",
  ["exec", "expo", "start", "--clear", "--web", ...process.argv.slice(2)],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: { ...process.env, APP_VARIANT: "preview", EXPO_PUBLIC_DEMO: "true" },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
