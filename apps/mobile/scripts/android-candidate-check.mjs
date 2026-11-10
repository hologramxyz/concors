import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { elfSupports16KB, manifestFailures } from "./android-artifact-check.mjs";

// Audit the uploaded bundle itself before deriving a separately signed emulator APK. No production
// signing key is downloaded. The derived APK cannot establish Play signing or physical FCM delivery.
const bundle = resolve(process.argv[2] ?? "");
const tool = resolve(process.env.BUNDLETOOL_JAR ?? "");
const versionCode = process.env.CANDIDATE_VERSION_CODE;
const expectedFingerprint = process.env.CANDIDATE_CERT_SHA256?.replaceAll(":", "").toLowerCase();
if (!bundle.endsWith(".aab") || !tool.endsWith(".jar") || !/^\d+$/.test(versionCode ?? ""))
  throw new Error("Pass an AAB, BUNDLETOOL_JAR and CANDIDATE_VERSION_CODE");
if (!/^[a-f0-9]{64}$/.test(expectedFingerprint ?? ""))
  throw new Error("CANDIDATE_CERT_SHA256 must be the public Expo upload certificate fingerprint");
const dump = (...args) =>
  execFileSync("java", ["-jar", tool, "dump", ...args, `--bundle=${bundle}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
execFileSync("java", ["-jar", tool, "validate", `--bundle=${bundle}`], { stdio: "ignore" });
const manifest = dump("manifest");
const targetSdk = /android:targetSdkVersion="(\d+)"/.exec(manifest)?.[1];
const permissions = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map(
  (match) => match[1],
);
const failures = manifestFailures(
  `targetSdkVersion:'${targetSdk}'`,
  permissions.map((p) => `'${p}'`).join("\n"),
);
if (!manifest.includes('package="xyz.hologram.concors"')) failures.push("Wrong production package");
if (!manifest.includes(`android:versionCode="${versionCode}"`)) failures.push("Wrong version code");
if (manifest.includes('android:debuggable="true"')) failures.push("Debuggable production bundle");
if (!manifest.includes('android:allowBackup="false"'))
  failures.push("Account backup must be disabled");
if (permissions.includes("android.permission.SYSTEM_ALERT_WINDOW"))
  failures.push("Unexpected overlay permission");
if (!permissions.includes("android.permission.POST_NOTIFICATIONS"))
  failures.push("Missing notification permission");
const firebaseAppId = "1:983205359805:android:b4c9cccc5514437538c7d4";
if (!dump("resources", "--resource=string/google_app_id", "--values").includes(firebaseAppId))
  failures.push("Production Firebase Android app is missing");
const config = JSON.parse(dump("config"));
if (config.optimizations?.uncompressNativeLibraries?.alignment !== "PAGE_ALIGNMENT_16K")
  failures.push("Bundle must request 16 KB native ZIP alignment");
const pem = execFileSync("keytool", ["-printcert", "-jarfile", bundle, "-rfc"], {
  encoding: "utf8",
});
const certificate = new X509Certificate(pem);
if (certificate.fingerprint256.replaceAll(":", "").toLowerCase() !== expectedFingerprint)
  failures.push("Bundle upload certificate differs from Expo signing credentials");
const directory = mkdtempSync(join(tmpdir(), "concors-bundle-audit-"));
const libraries = {};
try {
  execFileSync("unzip", [
    "-q",
    bundle,
    "base/lib/arm64-v8a/*.so",
    "base/lib/x86_64/*.so",
    "-d",
    directory,
  ]);
  for (const architecture of ["arm64-v8a", "x86_64"]) {
    const folder = join(directory, "base/lib", architecture);
    const entries = readdirSync(folder).filter((name) => name.endsWith(".so"));
    libraries[architecture] = entries.length;
    if (!entries.length) failures.push(`No native libraries for ${architecture}`);
    for (const name of entries) {
      const headers = execFileSync("readelf", ["-lW", join(folder, name)], { encoding: "utf8" });
      if (!elfSupports16KB(headers))
        failures.push(`16 KB ELF alignment missing: ${architecture}/${name}`);
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
if (failures.length) throw new Error(failures.join("\n"));
const result = {
  status: "passed",
  packageName: "xyz.hologram.concors",
  versionCode: Number(versionCode),
  sha256: createHash("sha256").update(readFileSync(bundle)).digest("hex"),
  uploadCertificateSha256: certificate.fingerprint256,
  targetSdk: Number(targetSdk),
  permissions,
  firebaseAppId,
  bundleNativeZipAlignment: "PAGE_ALIGNMENT_16K",
  elf16KBAlignedLibraries: libraries,
  physical16KBDeviceTested: false,
  physicalPushDeliveryTested: false,
};
const output = resolve(
  process.env.CANDIDATE_AUDIT_OUTPUT ?? "apps/mobile/test-results/android/candidate-audit.json",
);
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
process.stdout.write(
  `Production AAB ${versionCode}: identity, upload signature, Firebase, permissions and 16 KB library checks passed.\n`,
);
