import { readFile } from "node:fs/promises";
import { releaseFailures } from "./release-requirements.mjs";

try {
  const readiness = JSON.parse(
    await readFile(new URL("../release/readiness.json", import.meta.url), "utf8"),
  );
  const failures = releaseFailures(readiness, process.env);
  if (process.argv.includes("--json"))
    process.stdout.write(
      `${JSON.stringify({ ready: failures.length === 0, failures }, null, 2)}\n`,
    );
  else if (failures.length)
    console.error(
      `Not ready for store submission:\n${failures.map((name) => `  - ${name}`).join("\n")}`,
    );
  else
    process.stdout.write(
      "Recorded release evidence is complete. Recheck live console requirements before submission.\n",
    );
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(
    "Not ready for store submission: release evidence could not be validated.",
    error instanceof Error ? error.message : "Invalid evidence",
  );
  process.exitCode = 1;
}
