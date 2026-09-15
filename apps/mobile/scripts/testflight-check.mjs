import { readFile } from "node:fs/promises";
import { inspectTestFlight } from "./testflight-requirements.mjs";

const args = process.argv.slice(2);
if (args.some((arg) => !["--offline", "--json"].includes(arg))) {
  console.error("Usage: testflight:check [--offline] [--json]");
  process.exitCode = 1;
} else {
  try {
    const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
    const [readiness, { version }, eas] = await Promise.all([
      read("../release/readiness.json"),
      read("../package.json"),
      read("../eas.json"),
    ]);
    const result = await inspectTestFlight({
      readiness,
      version,
      eas,
      environment: process.env,
      offline: args.includes("--offline"),
    });
    if (args.includes("--json")) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else if (result.failures.length)
      console.error(
        `TestFlight preflight failed:\n${result.failures.map((failure) => `  - ${failure}`).join("\n")}`,
      );
    else
      process.stdout.write(
        result.readyToRequestBuild
          ? "Beta configuration and unauthenticated API probe passed. Expo/Apple access, signing and a real workspace still need verification. Nothing has been built or uploaded.\n"
          : "Offline configuration passed; API reachability was not tested. Nothing has been built or uploaded.\n",
      );
    if (result.failures.length) process.exitCode = 1;
  } catch {
    console.error("TestFlight preflight could not read or validate local configuration.");
    process.exitCode = 1;
  }
}
