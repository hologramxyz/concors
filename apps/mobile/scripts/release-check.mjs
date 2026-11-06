import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateFailures, releaseFailures } from "./release-requirements.mjs";

export async function checkRelease({
  candidate = false,
  json = false,
  platform = process.env.EAS_BUILD_PLATFORM === "ios" ? "ios" : "all",
} = {}) {
  try {
    const readiness = JSON.parse(
      await readFile(
        new URL(
          platform === "ios" ? "../release/readiness-ios.json" : "../release/readiness.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const failures = candidate
      ? candidateFailures(readiness, process.env, version)
      : releaseFailures(readiness, process.env, version, platform);
    if (json)
      process.stdout.write(
        `${JSON.stringify({ check: candidate ? "candidate-build" : "store-submission", platform, ready: failures.length === 0, failures }, null, 2)}\n`,
      );
    else if (failures.length)
      console.error(
        `Not ready for ${candidate ? "candidate build" : "store submission"}:\n${failures.map((name) => `  - ${name}`).join("\n")}`,
      );
    else
      process.stdout.write(
        candidate
          ? "Candidate configuration is valid. Build for testing only; submission remains gated by release:check. No account, signing or live-service validation is implied.\n"
          : "Recorded release evidence is complete. Recheck live console requirements before submission.\n",
      );
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(
      "Not ready for store submission: release evidence could not be validated.",
      error instanceof Error ? error.message : "Invalid evidence",
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) => !["--candidate", "--json", "--platform=ios", "--platform=all"].includes(arg),
    ) ||
    args.filter((arg) => arg.startsWith("--platform=")).length > 1
  ) {
    console.error("Usage: release:check [--candidate] [--json] [--platform=ios|all]");
    process.exitCode = 1;
  } else
    await checkRelease({
      candidate: args.includes("--candidate"),
      json: args.includes("--json"),
      platform: args.find((arg) => arg.startsWith("--platform="))?.split("=")[1],
    });
}
