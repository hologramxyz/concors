# Desktop releases and in-app updates

How a build of the desktop app is published, and how a running copy learns that a newer one
exists and replaces itself.

Two halves meet here. This repository builds and publishes the app; the control plane
(`concors-server`) pins one published version and answers the question a running app asks. The
app never talks to GitHub, because the repository is private and the release assets are not
public.

## The version lives in four files

`apps/desktop/package.json` is the source of truth. Three other files must carry the same number:

| File                                     | What it decides                                           |
| ---------------------------------------- | --------------------------------------------------------- |
| `apps/desktop/package.json`              | the version the client reports; `src/version.ts` reads it |
| `apps/desktop/src-tauri/tauri.conf.json` | the version compiled into the binary                      |
| `packaging/linux/PKGBUILD` (`pkgver`)    | the version pacman records                                |
| `apps/desktop/src-tauri/Cargo.toml`      | the crate version, shown by `cargo` and in a panic        |

Nothing keeps them together except a check, so bump them with one command rather than by hand:

```sh
pnpm desktop:version --set 0.3.0
cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --format-version 1 >/dev/null
```

That rewrites all four, resets the PKGBUILD's `pkgrel` to 1, and reads them back to check they
agree. `pnpm desktop:version` on its own prints the agreed version, or names every file that
disagrees, which is what the release workflow runs before building anything: a release whose pieces disagree would ask the control plane for updates
to a version it is not, and would never stop offering the one it already has.

## Publishing

Bump the version as above, merge to `main`, then tag the merge commit:

```sh
git tag -a desktop-v0.2.0 -m "Faster terminals and a quieter sidebar."
git push origin desktop-v0.2.0
```

The annotated tag's message becomes the release notes shown in the app before updating, so write
it for the person who will read it there.

`.github/workflows/desktop-release.yml` then builds on Ubuntu 24.04 — the oldest base supported,
which fixes the glibc floor — and produces:

| Asset                                        | For                                              |
| -------------------------------------------- | ------------------------------------------------ |
| `Concors-<version>-x64.tar.gz` (+ `.sha256`) | any Linux; extract and run `bin/concors-desktop` |
| `concors-bin-<version>-1-x86_64.pkg.tar.zst` | Arch and Omarchy, via `pacman -U`                |
| `release.json`                               | the control plane; nothing else reads it         |

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

## Offering the release

A published release reaches nobody until the control plane points at it. Set `DESKTOP_VERSION` on
the API to the version just published; until then every copy is told it is current. It is a
separate, deliberate step, so a release can be published and then rolled out — or held back.

**Publish first, pin second.** Pinning a version whose release does not exist yet leaves the update
check answering 502 until it does. Nothing is user-visible while that lasts — a failed check is
silence, and the rest of the API is untouched — but there is no reason to arrange it.

```sh
railway variable set DESKTOP_VERSION=0.2.0
```

The API reads only `release.json` from that release, over the same `GITHUB_TOKEN` the daemon
already uses. Builds are never proxied through it: a client asking to download one is redirected
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

## Not done yet

- **macOS and Windows.** The manifest and the endpoint already carry `platform` and `arch`; only
  the builds are missing.
- **Signed updates.** `release.json` and the update response both carry a `signature` field, empty
  until the release workflow signs builds with a minisign key. `tauri-plugin-updater` refuses an
  update without one, so signing is what stands between this and the plugin's own one-click update
  for AppImage, macOS and Windows. The endpoint already answers in the shape that plugin expects.
- **AppImage**, which would give a self-updating build to Linux users who are not on Arch.
