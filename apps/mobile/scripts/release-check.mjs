import { readFile } from "node:fs/promises";

const requirements = JSON.parse(
  await readFile(new URL("../release/readiness.json", import.meta.url), "utf8"),
);
const failures = Object.entries(requirements)
  .filter(([, complete]) => complete !== true)
  .map(([name]) => name);
if (process.env.EXPO_PUBLIC_DEMO === "true") failures.push("Disable demo mode");
if (process.env.EXPO_PUBLIC_DEV_DAEMON_URL) failures.push("Remove the development daemon override");
try {
  const api = new URL(process.env.EXPO_PUBLIC_API_URL ?? "");
  if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash)
    throw new Error("Unsafe API URL");
} catch {
  failures.push("Configure EXPO_PUBLIC_API_URL with production HTTPS and no credentials/query");
}
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "",
  )
)
  failures.push("Link the team's Expo project with EXPO_PUBLIC_EAS_PROJECT_ID");
if (failures.length) {
  console.error(
    `Not ready for store submission:\n${failures.map((name) => `  - ${name}`).join("\n")}`,
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    "Store prerequisites recorded as complete. Recheck current console requirements before submission.\n",
  );
