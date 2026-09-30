# Working in this repository

Concors is a client and runtime for orchestrating coding agents locally and on cloud machines.
This file is the short version; `docs/` holds the detail and is worth reading before changing an
area you have not touched before.

The control plane is a **separate repository**, normally checked out next to this one at
`../concors-server`. Changes that cross the two (an endpoint plus the client that calls it) need a
pull request in each, and the server one merges first.

## Checks

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

CI on pushes and pull requests runs only these fast checks. The slow suites (browser acceptance,
Tauri/Rust, bundle smoke tests, macOS/Windows runners) live in `.github/workflows/heavy-tests.yml`
and run only when dispatched by hand, so run them before a release or after touching what they
cover. Confirm a failure also happens on `main` before treating it as yours.

Anything the shared UI imports from `@/tauri` must also exist in
`apps/desktop/src/mobile/native-platform.ts`. The mobile bundle aliases one to the other, and a
missing export there breaks mobile releases while every test still passes. Rebuild it with
`pnpm --filter @concors/mobile assets` after adding an export.

## Releasing

**Actions → Release → Run workflow**, on `main`. That is the whole procedure; nothing is bumped,
tagged or pinned by hand. The form asks:

| Input                | What it decides                                                           |
| -------------------- | ------------------------------------------------------------------------- |
| **component**        | `desktop`, `daemon` or `both`. Release only what changed (see below)      |
| **bump**             | `patch` or `minor`, from the version on `main`                            |
| **notes**            | shown in the app's update dialog, so write them for the people reading it |
| **roll_out_desktop** | on by default: offer the release to every copy, and to new downloads      |
| **roll_out_daemon**  | off by default: a new daemon restarts every cloud machine's sessions      |

Or from a terminal:
`gh workflow run release.yml -f component=desktop -f notes="What changed, in plain words."`

The workflow runs the slow suites (`heavy-tests.yml`; the workspace browser suite fails on `main`
today, so for now it reports without blocking), commits the new version to `main` and tags
it, builds and publishes (Linux packages and a notarized Mac disk image for the desktop, a tarball
for the daemon), downloads what it published to check it, then rolls out: it sets
`DESKTOP_VERSION`/`DAEMON_VERSION` on the control plane and marks the desktop release Latest, which
is what the website's download button follows. If a build fails, "Re-run failed jobs" retries the
same version.

The desktop app and the daemon keep separate versions because rolling out a daemon ends the
terminals and agents running on cloud machines, so a desktop-only release must not do that.

**Roll out later, or roll back:** Actions → **Roll out** with the version to offer. It is the same
step the release ends with, and naming an earlier version rolls back to it.

What the app does with a release, and how the Mac build is signed, is in
[docs/desktop-releases.md](docs/desktop-releases.md). The workflow needs these repository secrets:
the five Apple ones listed there, and `RAILWAY_TOKEN`, a project token for the production
environment of the `concors` project in the Holoworld AI Railway workspace.

**Once a pull request is ready for review, stop pushing to it.** Anything else, such as a
follow-up fix, gets its own pull request. A commit pushed to a branch someone is already merging is
simply not in the merge, and the result looks merged while missing the very thing it was for.

Two habits worth keeping, both learned the hard way:

- **CI never exercises the release workflows.** They run only when someone releases; their
  container steps can be run locally with Docker, and `actionlint` catches most mistakes in them.
  Check after changing them rather than finding out during a release.
- **Read back what you wrote.** Both bugs in the first release — a pacman flag that skipped the
  wrong checks, and release notes that silently became "Merge pull request #124" — were invisible
  until someone looked at the actual output.

## House style

Comments explain _why_, at the altitude of the decision — a module's opening comment says what it
is for and what it deliberately does not do. Prefer a pure function plus a thin wrapper that reads
files or calls the network, so the decision can be tested without the world. New behaviour that can
break quietly gets a test that would catch it.

Do not add `Co-Authored-By` trailers, `--author`, or "Generated with Claude Code" lines to commits
in this repository.
