import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function manifestFailures(badging, permissions) {
  const failures = [];
  const sdk = /targetSdkVersion:'(\d+)'/.exec(badging)?.[1];
  if (!sdk || Number(sdk) < 36) failures.push("Android target SDK must be at least 36");
  for (const name of [
    "CAMERA",
    "RECORD_AUDIO",
    "READ_MEDIA_IMAGES",
    "READ_MEDIA_VIDEO",
    "READ_EXTERNAL_STORAGE",
    "WRITE_EXTERNAL_STORAGE",
    "MANAGE_EXTERNAL_STORAGE",
    "READ_CONTACTS",
    "ACCESS_FINE_LOCATION",
    "ACCESS_BACKGROUND_LOCATION",
  ]) {
    if (permissions.includes(`'android.permission.${name}'`))
      failures.push(`Unexpected permission: ${name}`);
  }
  return failures;
}
export function elfSupports16KB(headers) {
  const loads = headers.split("\n").filter((line) => /^\s*LOAD\s/.test(line));
  return (
    loads.length > 0 &&
    loads.every((line) => {
      const alignment = line.trim().split(/\s+/).at(-1);
      return !!alignment && Number(alignment) >= 16384;
    })
  );
}

export function artifactArchitectures(value = "arm64-v8a,x86_64") {
  const architectures = value.split(",");
  if (architectures.some((architecture) => !["arm64-v8a", "x86_64"].includes(architecture)))
    throw new Error("Expected arm64-v8a and/or x86_64 architectures");
  return architectures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const apk = resolve(process.argv[2] ?? "");
  const architectures = artifactArchitectures(process.argv[3]);
  if (!apk.endsWith(".apk")) throw new Error("Pass the generated APK path");
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error("ANDROID_HOME is required for aapt and zipalign");
  const versions = readdirSync(join(sdk, "build-tools")).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
  if (!versions[0]) throw new Error("No Android build-tools installed");
  const tools = join(sdk, "build-tools", versions[0]);
  const badging = execFileSync(join(tools, "aapt"), ["dump", "badging", apk], { encoding: "utf8" });
  const permissions = execFileSync(join(tools, "aapt"), ["dump", "permissions", apk], {
    encoding: "utf8",
  });
  const failures = manifestFailures(badging, permissions);
  execFileSync(join(tools, "zipalign"), ["-c", "-P", "16", "4", apk], { stdio: "inherit" });
  const directory = mkdtempSync(join(tmpdir(), "concors-apk-audit-"));
  try {
    // Extract only the known 64-bit native library directories into this newly created folder.
    execFileSync("unzip", [
      "-q",
      apk,
      ...architectures.map((architecture) => `lib/${architecture}/*.so`),
      "-d",
      directory,
    ]);
    for (const architecture of architectures) {
      const folder = join(directory, "lib", architecture);
      const libraries = readdirSync(folder).filter((name) => name.endsWith(".so"));
      if (!libraries.length) failures.push(`No native libraries for ${architecture}`);
      for (const library of libraries) {
        const headers = execFileSync("readelf", ["-lW", join(folder, library)], {
          encoding: "utf8",
        });
        if (!elfSupports16KB(headers))
          failures.push(`16 KB ELF alignment missing: ${architecture}/${library}`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write(
    `APK target SDK, restricted permissions, ZIP alignment and ${architectures.join(", ")} ELF architectures passed. Physical 16 KB-device testing is still required.\n`,
  );
}
