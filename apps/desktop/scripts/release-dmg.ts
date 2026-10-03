import { execFileSync } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { desktopVersion, repoRoot } from "./release-version.ts";

// Takes the disk image `desktop:package:macos` built and makes it the one we publish: renamed to
// the release's naming scheme, signed, notarized and stapled so it opens on a Mac that has never
// seen Concors. Tauri signs and notarizes the app inside while bundling; the image around it needs
// the same, because Gatekeeper judges a download by the image first and refuses an unsigned one
// before anyone reaches the app.
//
// Credentials are the ones Tauri already reads, so one environment serves both steps:
// APPLE_SIGNING_IDENTITY, and APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH for the
// notary service. Without them the image is only copied, and the script says it will not open
// elsewhere. `--require-notarized` turns that warning into a failure, for the release workflow.

if (process.platform !== "darwin") throw new Error("Build the macOS release on macOS.");

/** The control plane's arch names, which the release manifest matches on. */
const arch = { arm64: "aarch64", x64: "x86_64" }[process.arch as string];
if (!arch) throw new Error(`No macOS release for ${process.arch}.`);

const version = await desktopVersion();
const built = join(repoRoot, "apps/desktop/src-tauri/target/release/bundle/dmg");
// Tauri names the image `Concors_<version>_<its arch>.dmg`, and its arch for Intel is `x64`.
const images = (await readdir(built).catch(() => [])).filter(
  (name) => name.startsWith(`Concors_${version}_`) && name.endsWith(".dmg"),
);
const [builtImage] = images;
if (images.length !== 1 || !builtImage)
  throw new Error(
    `Expected one Concors ${version} disk image in ${built}, found ${images.length}; ` +
      "run `pnpm desktop:package:macos` first.",
  );

const release = join(repoRoot, "apps/desktop/dist/release");
await mkdir(release, { recursive: true });
const image = join(release, `Concors-${version}-${arch}.dmg`);
await copyFile(join(built, builtImage), image);

const identity = process.env["APPLE_SIGNING_IDENTITY"];
const key = process.env["APPLE_API_KEY"];
const issuer = process.env["APPLE_API_ISSUER"];
const keyPath = process.env["APPLE_API_KEY_PATH"];

if (!identity || identity === "-" || !key || !issuer || !keyPath) {
  const message = `${image} is not notarized, so it opens only on this Mac.`;
  if (process.argv.includes("--require-notarized")) throw new Error(message);
  process.stdout.write(`warning: ${message}\n`);
} else {
  execFileSync("codesign", ["--force", "--sign", identity, "--timestamp", image], {
    stdio: "inherit",
  });
  const credentials = ["--key", keyPath, "--key-id", key, "--issuer", issuer];
  // The verdict is read from the result rather than the exit code, and a rejection prints Apple's
  // log, which names the file that failed; the status alone says only "Invalid".
  const submission = JSON.parse(
    execFileSync(
      "xcrun",
      ["notarytool", "submit", image, ...credentials, "--wait", "--output-format", "json"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ),
  ) as { id: string; status: string };
  if (submission.status !== "Accepted") {
    execFileSync("xcrun", ["notarytool", "log", submission.id, ...credentials], {
      stdio: "inherit",
    });
    throw new Error(`Notarization of ${image} ended ${submission.status}.`);
  }
  execFileSync("xcrun", ["stapler", "staple", image], { stdio: "inherit" });
  // What a downloading Mac will conclude, asked the same way it asks: this is the check that fails
  // when anything above quietly did not happen.
  execFileSync(
    "spctl",
    ["--assess", "--type", "open", "--context", "context:primary-signature", "--verbose", image],
    { stdio: "inherit" },
  );
  // And the app someone drags out of it, which must carry its own ticket to open offline.
  const mount = await mkdtemp(join(tmpdir(), "concors-dmg-"));
  execFileSync("hdiutil", ["attach", image, "-readonly", "-nobrowse", "-mountpoint", mount], {
    stdio: "inherit",
  });
  try {
    const app = join(mount, "Concors.app");
    execFileSync("spctl", ["--assess", "--type", "execute", "--verbose", app], {
      stdio: "inherit",
    });
    execFileSync("xcrun", ["stapler", "validate", app], { stdio: "inherit" });
    // Finder records the window's layout in .DS_Store; without it the image opens as a bare
    // folder, which is what a skipped Finder pass leaves behind without failing the build.
    for (const name of [".DS_Store", ".background/dmg-background.tiff"])
      await access(join(mount, name)).catch(() => {
        throw new Error(`${image} has no ${name}, so its window opens without its layout.`);
      });
  } finally {
    execFileSync("hdiutil", ["detach", mount], { stdio: "inherit" });
  }
}
process.stdout.write(`${image}\n`);
