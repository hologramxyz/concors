import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localIosEnvironment } from "./ios-local-environment.mjs";

const directory = fileURLToPath(new URL("..", import.meta.url));
async function main() {
  const mode = process.argv[2] ?? "run";
  if (process.argv.length > 3 || !["run", "prepare", "start"].includes(mode))
    throw new Error("Usage: ios:local [run|prepare|start]");
  if (process.platform !== "darwin")
    throw new Error(
      "Local iPhone installation requires macOS and Xcode. Run this command on your Mac.",
    );
  const env = localIosEnvironment(process.env);
  if (mode !== "start") {
    try {
      execFileSync("xcodebuild", ["-version"], { stdio: "ignore" });
    } catch {
      throw new Error(
        "Install/open full Xcode, finish its first-run setup, and select it as the active developer directory.",
      );
    }
  }
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn("pnpm", args, { cwd: directory, env, stdio: "inherit" });
      const interrupt = () => child.kill("SIGINT");
      const terminate = () => child.kill("SIGTERM");
      process.once("SIGINT", interrupt);
      process.once("SIGTERM", terminate);
      const cleanup = () => {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", terminate);
      };
      child.once("error", () => {
        cleanup();
        reject(
          new Error(
            "Could not start pnpm. Install the repository's Node/pnpm versions on your Mac.",
          ),
        );
      });
      child.once("exit", (code) => {
        cleanup();
        if (code === 0) resolve();
        else
          reject(
            new Error(
              "The local iPhone command failed. Check the tool output above; no cloud build or upload was attempted.",
            ),
          );
      });
    });
  process.stdout.write(
    `Preparing Concors Dev for ${env.EXPO_PUBLIC_API_URL}. Push is disabled; no Expo login or paid Apple membership is used.\n`,
  );
  await run(["assets"]);
  if (mode === "start") {
    await run(["exec", "expo", "start", "--dev-client", "--clear"]);
    return;
  }
  // Never --clean: preserve generated signing settings and do not delete an existing project.
  await run(["exec", "expo", "prebuild", "--platform", "ios"]);
  if (mode === "prepare") {
    process.stdout.write(
      "Open the .xcworkspace in apps/mobile/ios, choose your Personal Team and iPhone in Xcode, then run ios:local start in another terminal before pressing Run.\n",
    );
    return;
  }
  await run(["exec", "expo", "run:ios", "--device"]);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Local iPhone setup failed.");
  process.exitCode = 1;
});
