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

| Asset                                             | For                                                   |
| ------------------------------------------------- | ----------------------------------------------------- |
| `Concors-<version>-x86_64.AppImage` (+ `.sha256`) | any Linux; one file to make executable and run        |
| `Concors-<version>-x64.tar.gz` (+ `.sha256`)      | any Linux; extract and run `bin/concors-desktop`      |
| `concors-bin-<version>-1-x86_64.pkg.tar.zst`      | Arch and Omarchy, via `pacman -U`                     |
| `release.json`                                    | the control plane; nothing else reads it              |
| `Concors-linux-x86_64.AppImage`                   | the website's Linux download; see below               |
| `Concors-linux-x64.tar.gz`                        | a stable link to the latest tarball, for the same use |
| `Concors-linux-x86_64.pkg.tar.zst`                | the website's Arch and Omarchy install command        |

and, on a macOS runner, `Concors-<version>-aarch64.dmg` for Apple Silicon (see [macOS](#macos)),
and on a Windows runner `Concors-<version>-x86_64-setup.exe` (see [Windows](#windows)), with
`Concors-mac-arm64.dmg` and `Concors-windows-x64-setup.exe` as their stable links. The release
manifest is written once all of them have finished, so it describes every build.

Before publishing, the workflow installs the package in a clean `archlinux` container and runs the
bundled daemon there, so a package that cannot actually be installed never reaches a release.
Nothing is compiled inside that container: `package()` only restages the tarball.

The AppImage is Tauri's `appimage` bundle of the same binary and daemon, built in the same job.
An AppImage runs from a read-only mount of itself, so the workflow extracts it, mounts the result
read-only in a clean `ubuntu:24.04` container with no Node or compilers, and runs the bundle smoke
test against the daemon where it lies (`smoke-bundle.ts --in-place`) as well as from a copy: a
daemon that wrote beside itself, or a native module that no longer loaded, fails the release there.
It is the image's own daemon that is tested, because the AppImage tooling edits the ELF files it
finds on the way in (today it gives Node and node-pty's module a `$ORIGIN` run path).

To build the same artifacts locally on Arch:

```sh
VITE_CONCORS_API_URL=https://api.concors.dev pnpm desktop:package:linux --bundles appimage
pnpm desktop:release:linux
pnpm desktop:release:appimage
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
Intel would be a second job on an Intel runner.

A Mac copy updates itself from this same disk image (see the table below). `update.rs` mounts it,
checks the digest, then that the app inside is signed by the same developer team as the running
copy, passes `codesign --verify --deep --strict` and is accepted by Gatekeeper as notarized, and
only then swaps the bundles. The signature check is what proves the build is ours, which the
digest alone cannot: the digest comes from the same control plane that serves the download.

## Windows

The Windows build is an NSIS installer, Authenticode-signed with
[Azure Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/) (formerly
Trusted Signing). As for the Mac, without signing credentials the workflow skips the Windows job
with a warning: SmartScreen warns hardest about an unsigned installer, and teaching people to click
past that warning is worse than not offering the download. Signing does not make the first
downloads warning-free either — SmartScreen builds a reputation per publisher, which no
certificate buys outright any more — but each signed release adds to the same publisher's, and the
installer names Concors rather than "Unknown publisher".

`package-windows.ts` packages the daemon runtime (Node's own `node.exe`, npm, node-pty with
ConPTY, the sherpa-onnx addon and ONNX Runtime), signs every executable in it that does not already
carry a signature (Node and ConPTY arrive signed by their publishers), runs the bundle smoke test,
and then has Tauri build the installer, signing the app before the installer embeds it and then the
installer and its uninstaller. The workflow then installs it silently, checks that Windows calls
every shipped binary's signature Valid, and runs the installed daemon's smoke test where it landed.

Two things differ from the other platforms:

- **There is no `concors-daemon` launcher.** Windows cannot run a shell script, and a `.cmd`
  wrapper would stand between the app and Node, so stopping the gateway would stop only the
  wrapper. The app starts `daemon\bin\node.exe daemon\lib\cli.js` itself, without a console
  window (`daemon.rs`). `bin\npm.cmd` remains, since the daemon finds npm by name.
- **A running runtime blocks an update.** Windows will not overwrite a running program, and the
  session host outlives the window on purpose. The installer's hook
  (`src-tauri/windows/installer-hooks.nsh`) closes the app the way Tauri's installer does, then
  stops every process running from that installation's `daemon\` before writing or removing files.
  The heavy-tests job checks this by reinstalling over a running copy of the bundled Node.

The installer installs per user, into `%LOCALAPPDATA%\Concors`, so neither installing nor
updating asks for an administrator. The `windows-installer` job in `heavy-tests.yml` builds,
installs and smoke-tests the same installer, unsigned, on every pull request, so a packaging
regression shows there rather than during a release. Locally, on Windows x64:

```sh
VITE_CONCORS_API_URL=https://api.concors.dev pnpm desktop:package:windows
pnpm desktop:release:windows
```

The build is unsigned unless the six variables below are in the environment, and signing locally
also needs `cargo install artifact-signing-cli`.

### Setting up Artifact Signing

It costs $9.99 a month (Basic: 5,000 signatures, one certificate profile, which is plenty).
Organizations in the US, Canada, the EU and the UK can use it; individual developers only in the US
and Canada, so it is set up for the company. Microsoft verifies the organization before issuing
anything, which usually takes from a few hours to a few business days.

1. In the [Azure portal](https://portal.azure.com), on a paid (pay-as-you-go) subscription — free
   and trial subscriptions are refused — register the `Microsoft.CodeSigning` resource provider
   (Subscription → Resource providers).
2. Create an **Artifact Signing account**, Basic tier, in a region near the build (for example West
   Europe, whose endpoint is `https://weu.codesigning.azure.net`). The account's Overview shows
   its endpoint.
3. On the account, give yourself the **Identity Verifier** role (Access control (IAM)), then
   create an **identity validation** of type _Public_ for the organization, with its legal name,
   address and a contact email on the company's own domain. Wait for it to be approved.
4. Create a **certificate profile** of type _Public Trust_ from the approved identity.
5. In Microsoft Entra ID → App registrations, register an app (any name, e.g. `concors-release`)
   and create a client secret for it. Note its client ID, the tenant ID and the secret.
6. On the certificate profile, give that app registration the **Certificate Profile Signer**
   role. Assigning it to yourself instead is the usual mistake, and fails with 403 at signing.
7. In the GitHub repository's settings, add:

| Kind     | Name                                         | Value                                       |
| -------- | -------------------------------------------- | ------------------------------------------- |
| secret   | `AZURE_CLIENT_ID`                            | the app registration's client ID            |
| secret   | `AZURE_CLIENT_SECRET`                        | its client secret                           |
| secret   | `AZURE_TENANT_ID`                            | the directory (tenant) ID                   |
| variable | `AZURE_ARTIFACT_SIGNING_ENDPOINT`            | the account's endpoint, from step 2         |
| variable | `AZURE_ARTIFACT_SIGNING_ACCOUNT`             | the Artifact Signing account's name         |
| variable | `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` | the certificate profile's name, from step 4 |

The client secret expires (at most after two years); a release after that fails at signing, and a
new secret is the fix. A Windows copy is told about new releases (it asks for the `nsis` format)
but does not yet install them itself: the dialog asks the person to run the new installer, which
updates in place.

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
links to `releases/latest/download/Concors-mac-arm64.dmg` and
`releases/latest/download/Concors-linux-x86_64.AppImage`, copies of the disk image and the AppImage
every release also publishes under those fixed names. Releases are published with `--latest=false` so that this,
too, waits for the rollout. Last, it asks the API for an update the way an old copy would, and
fails unless the answer is the version just rolled out.

Rolling out a daemon version (`DAEMON_VERSION`) is gentler, because installing one restarts a
cloud machine's agents. It only makes the version available: each machine updates when no agent
on it is working or waiting, or when its owner presses **Update now** on the machine's card in
Settings → Machines (see [managed machines](managed-machines-v1.md), 4.4).

The API reads only `release.json` from that release, anonymously, since the repository is
public. Builds are never proxied through it: a client asking to download one is redirected
to a short-lived link, so a 50 MB package never occupies API memory.

For development, `DESKTOP_MANIFEST_PATH` points at a local `release.json` instead of a published
release. Downloads are refused in that mode, since the builds it describes are on the machine that
produced them.

## The AUR

Arch and Omarchy users can install `concors-bin` from the AUR (`yay -S concors-bin`), and their AUR
helper updates it like any other package. It is the same `packaging/linux/PKGBUILD` the release
builds, whose source is the release's tarball on GitHub: when the release workflow builds the
package, the tarball is already in place and makepkg downloads nothing.

Rolling out a desktop version (`roll-out.yml`, also the end of every release) then publishes it.
`packaging/linux/prepare-aur.sh` runs in a clean `archlinux` container: it replaces the
checked-in `SKIP` digests with the published tarball's, writes `.SRCINFO`, and builds the package
from the release exactly as a user's makepkg would. Only then does the job push those four files to
`ssh://aur@aur.archlinux.org/concors-bin.git`, authenticated with the `AUR_SSH_PRIVATE_KEY`
secret, whose public half is on the maintainer's AUR account, and trusting only the host key the
AUR publishes. Rolling back to an older version leaves the AUR alone, since AUR helpers never
downgrade.

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
| an AppImage in a directory the person can write to   | replaces the file in place, keeping its name, and relaunches it      |
| a Mac app in a folder the person can write to        | installs the disk image's app over it (signature checked), restarts  |
| a Windows installation                               | says a new version exists; running the new installer updates it      |
| a tree it cannot write to, or an unfamiliar location | says a new version exists and leaves it to them                      |
| a build from a checkout                              | nothing at all; the checkout is the source of truth                  |

The badge sits above the account menu in the sidebar and is absent whenever there is nothing to
say. A failed check is silence, not an error: the control plane being unreachable is not worth
interrupting anyone about.

An AppImage is recognised by the `APPIMAGE` and `APPDIR` variables its runtime sets, and only when
the running executable is inside `APPDIR`: both are inherited by anything started from an AppImage,
and a copy of Concors launched from another AppImage's terminal must not replace that program. The
new image is written beside the old one and renamed over it, so the running copy keeps reading the
file it mounted until it restarts, and a desktop entry pointing at the file keeps working.

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

- **Intel Macs**, and **Windows on Arm** (which runs the x64 build under emulation). The manifest
  and the endpoint already carry `platform` and `arch`; only the builds are missing.
- **Windows updating itself.** A Windows copy is told a release exists; installing it from the
  badge (download, check, run the installer passively, restart) is still to do.
- **`tauri-plugin-updater` itself**, whose one-click path covers AppImage, macOS and Windows. The
  endpoint already answers in the shape the plugin expects, and builds are signed once a key
  exists, so what remains is the plugin and the Windows builds. Until then the badge replaces an
  AppImage or a tarball itself after checking the digest but not a signature; a Mac app is checked
  against Apple's code signature and notarization instead.
