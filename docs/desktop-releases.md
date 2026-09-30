# Desktop releases and in-app updates

How a build of the desktop app is published, and how a running copy learns that a newer one
exists and replaces itself.

Two halves meet here. This repository builds and publishes the app; the control plane
(`concors-server`) pins one published version and answers the question a running app asks. The
app never talks to GitHub itself: the API reads the release and hands out download links.

## The version lives in four files

`apps/desktop/package.json` is the source of truth. Three other files must carry the same number:

| File                                     | What it decides                                           |
| ---------------------------------------- | --------------------------------------------------------- |
| `apps/desktop/package.json`              | the version the client reports; `src/version.ts` reads it |
| `apps/desktop/src-tauri/tauri.conf.json` | the version compiled into the binary                      |
| `packaging/linux/PKGBUILD` (`pkgver`)    | the version pacman records                                |
| `apps/desktop/src-tauri/Cargo.toml`      | the crate version, shown by `cargo` and in a panic        |

Nothing keeps them together except a check, and nobody edits them by hand: the Release workflow
bumps all four through `release-plan.ts`, with the same code as `pnpm desktop:version --set`. That
rewrites all four, resets the PKGBUILD's `pkgrel` to 1, and reads them back to check they agree. `pnpm desktop:version` on its own prints the agreed version, or names every file that
disagrees, which is what the release workflow runs before building anything: a release whose pieces disagree would ask the control plane for updates
to a version it is not, and would never stop offering the one it already has.

## Publishing

Releases are made by the Release workflow (Actions → Release → Run workflow on `main`; see
Releasing in AGENTS.md). It commits the bumped version to `main`, tags that commit
`desktop-v<version>` with the notes, and hands the version to
`.github/workflows/desktop-release.yml`. The notes become the release notes shown in the app
before updating, so write them for the person who will read them there.

`desktop-release.yml` builds on Ubuntu 24.04 — the oldest base supported,
which fixes the glibc floor — and produces:

| Asset                                        | For                                              |
| -------------------------------------------- | ------------------------------------------------ |
| `Concors-<version>-x64.tar.gz` (+ `.sha256`) | any Linux; extract and run `bin/concors-desktop` |
| `concors-bin-<version>-1-x86_64.pkg.tar.zst` | Arch and Omarchy, via `pacman -U`                |
| `release.json`                               | the control plane; nothing else reads it         |
| `Concors-linux-x64.tar.gz`                   | the website's Linux download; see below          |

and, on a macOS runner, `Concors-<version>-aarch64.dmg` for Apple Silicon (see [macOS](#macos)).
The release manifest is written once both have finished, so it describes every build.

Before publishing, the workflow installs the package in a clean `archlinux` container and runs the
bundled daemon there, so a package that cannot actually be installed never reaches a release.
Nothing is compiled inside that container: `package()` only restages the tarball.

To build the same artifacts locally on Arch:

```sh
VITE_CONCORS_API_URL=https://api.concors.dev pnpm desktop:package:linux --no-bundle
pnpm desktop:release:linux
packaging/linux/build-package.sh \
  apps/desktop/dist/release/Concors-0.2.0-x64.tar.gz 0.2.0 apps/desktop/dist/release
pnpm desktop:release:manifest --notes "What changed."
```

## macOS

The Mac build is a signed, notarized disk image. Unlike Linux, an unsigned one is worse than none —
macOS reports it as damaged and offers to move it to the bin — so without Apple credentials the
workflow skips the Mac job with a warning and publishes Linux alone.

Signing covers more than the app. The bundled daemon carries its own native code (Node, node-pty
and its `spawn-helper`, the sherpa-onnx addon and ONNX Runtime), and notarization rejects a bundle
if any of it is unsigned. `package-macos.ts` signs each of those with the same identity before
Tauri bundles them, and Node with `src-tauri/macos/node.entitlements`, since V8 cannot run under
the hardened runtime without them. The nodejs.org signature cannot simply be kept: it carries
`get-task-allow`, which notarization refuses. The app itself gets `macos/app.entitlements`, whose
microphone entitlement dictation depends on.

`pnpm desktop:release:macos` then signs, notarizes and staples the image and asks Gatekeeper about
it, and about the app inside it, the way a downloading Mac would. Locally:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)"
export APPLE_API_KEY=<key id> APPLE_API_ISSUER=<issuer id> APPLE_API_KEY_PATH=~/.concors/AuthKey.p8
VITE_CONCORS_API_URL=https://api.concors.dev pnpm desktop:package:macos
pnpm desktop:release:macos
```

The workflow needs these repository secrets:

| Secret                       | What it is                                                           |
| ---------------------------- | -------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | the Developer ID Application certificate and key, as a base64 `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the password the `.p12` was exported with                            |
| `APPLE_API_KEY`              | an App Store Connect API key's ID, for the notary service            |
| `APPLE_API_ISSUER`           | that key's issuer ID                                                 |
| `APPLE_API_PRIVATE_KEY`      | the key's `.p8` file, as text                                        |

Only Apple Silicon is built. The daemon runtime bundles the host's Node and native modules, so
Intel would be a second job on an Intel runner. Macs are not offered in-app updates yet: the
control plane does not know the `dmg` format, and `update.rs` does not recognise an app bundle as
an installation it could replace.

## Offering the release

A published release reaches nobody until the control plane points at it: until `DESKTOP_VERSION`
on the API names it, every copy is told it is current. The Release workflow ends by doing that
(`roll-out.yml`) unless `roll_out_desktop` was turned off, and the Roll out workflow does it on its
own, for a release held back or to roll back to an earlier one.

**Publish first, pin second.** Pinning a version whose release does not exist yet leaves the update
check answering 502 until it does. Nothing is user-visible while that lasts — a failed check is
silence, and the rest of the API is untouched — but there is no reason to arrange it.

Rolling out sets `DESKTOP_VERSION` on the production `concors-server` (with the `RAILWAY_TOKEN`
secret), then marks the release GitHub's Latest, which is what new downloads follow: the website
links to `releases/latest/download/Concors-mac-arm64.dmg`, a copy of the disk image every release
also publishes under that fixed name. Releases are published with `--latest=false` so that this,
too, waits for the rollout. Last, it asks the API for an update the way an old copy would, and
fails unless the answer is the version just rolled out.

The API reads only `release.json` from that release, anonymously, since the repository is
public. Builds are never proxied through it: a client asking to download one is redirected
to a short-lived link, so a 50 MB package never occupies API memory.

For development, `DESKTOP_MANIFEST_PATH` points at a local `release.json` instead of a published
release. Downloads are refused in that mode, since the builds it describes are on the machine that
produced them.

## What a running app does

On launch, every 30 minutes after, and whenever its window comes back to the front, the app asks
`GET /api/v1/releases/desktop/:platform/:arch/:version`, which answers `204` when there is nothing
to offer. The focus check is throttled to once every five minutes, and it is the one that matters:
coming back to Concors is when someone would look for a badge, and an interval alone leaves it
missing from exactly that moment. The request costs little enough that the timings are chosen by
how soon someone should find out — an empty answer has no body, and the control plane serves it
from a manifest it already holds in memory. The check needs no session — it reveals only what we publish, and it runs before anyone
signs in. Downloading a build does need one.

What the app can do about an answer depends on how that copy was installed, which the native side
works out from where its executable lives (`src-tauri/src/update.rs`):

| How it was installed                                 | What the badge does                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| a pacman package (`/opt/Concors`)                    | downloads the package and installs it with `pkexec pacman -U`        |
| a tarball the person unpacked and can write to       | replaces the tree, keeping the old one until the new one is in place |
| a tree it cannot write to, or an unfamiliar location | says a new version exists and leaves it to them                      |
| a build from a checkout                              | nothing at all; the checkout is the source of truth                  |

The badge sits above the account menu in the sidebar and is absent whenever there is nothing to
say. A failed check is silence, not an error: the control plane being unreachable is not worth
interrupting anyone about.

Downloads are verified against the digest in `release.json` before anything is installed, and the
session token is passed to `curl` through its stdin configuration rather than its command line, so
it does not appear in the process list. `curl` is told explicitly not to carry that credential
across the redirect to the host storing the build.

**Installing ends local terminals and agent sessions.** The new build brings its own daemon, and a
session host is replaced when the daemon behind it changes (see
[session recovery](./session-recovery.md)). Projects, history and settings survive. The dialog says
so before anything is downloaded.

## Signing

The release workflow signs each build when `TAURI_SIGNING_PRIVATE_KEY` is set, publishes the
detached `.sig` files alongside the builds, and carries each signature in `release.json`, which the
control plane passes straight through to the app.

Without the key a release still publishes. It is simply unsigned, the workflow says so with a
warning annotation, and `release-manifest.ts` prints which builds went out that way. The badge
installs an unsigned build after checking its digest; a signature is what proves a build came from
us rather than from whoever served it, and it is what `tauri-plugin-updater` refuses to go without.

To start signing, generate a key and keep both halves somewhere you will not lose them — **a lost
private key cannot be replaced, and every copy of the app trusts only the key its build was
verified against**:

```sh
pnpm --filter @concors/desktop exec tauri signer generate -w ~/.concors/updater.key
```

Add the private key and its password as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public half goes in `tauri.conf.json` when the updater
plugin is adopted; nothing reads it before then.

## Not done yet

- **Windows**, and **Intel Macs**. The manifest and the endpoint already carry `platform` and
  `arch`; only the builds are missing.
- **AppImage**, which would give a self-updating build to Linux users who are not on Arch.
- **`tauri-plugin-updater` itself**, whose one-click path covers AppImage, macOS and Windows. The
  endpoint already answers in the shape the plugin expects, and builds are signed once a key
  exists, so what remains is the plugin and the builds for those platforms.
