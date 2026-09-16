import { spawn } from "node:child_process";
import { demoEnvironment } from "./demo-environment.mjs";

const child = spawn(
  "pnpm",
  ["exec", "expo", "start", "--clear", "--web", ...process.argv.slice(2)],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
    env: demoEnvironment(process.env),
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
