import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateFailures, releaseFailures } from "./release-requirements.mjs";

export async function checkRelease({ candidate = false, json = false } = {}) {
  try {
    const readiness = JSON.parse(
      await readFile(new URL("../release/readiness.json", import.meta.url), "utf8"),
    );
    const { version } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    const failures = (candidate ? candidateFailures : releaseFailures)(
      readiness,
      process.env,
      version,
    );
    if (json)
      process.stdout.write(
        `${JSON.stringify({ check: candidate ? "candidate-build" : "store-submission", ready: failures.length === 0, failures }, null, 2)}\n`,
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkRelease({
    candidate: process.argv.includes("--candidate"),
    json: process.argv.includes("--json"),
  });
