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

CI (`ci.yml`) runs these fast checks on every push and pull request. The slow suites (browser
acceptance, Tauri/Rust, bundle smoke tests, macOS/Windows runners) live in
`.github/workflows/heavy-tests.yml` and run on every pull request that touches more than docs,
split across runners so they take about as long as the slowest shard. Confirm a failure also
happens on `main` before treating it as yours.

Anything the shared UI imports from `@/tauri` must also exist in
`apps/desktop/src/mobile/native-platform.ts`. The mobile bundle aliases one to the other, and a
missing export there breaks mobile releases while every test still passes. Rebuild it with
`pnpm --filter @concors/mobile assets` after adding an export.

## Releasing

**Actions → Release → Run workflow**, on `main`. That is the whole procedure; nothing is bumped,
tagged or pinned by hand. The form asks:

| Input                | What it decides                                                           |
| -------------------- | ------------------------------------------------------------------------- |
| **component**        | `both` by default; `desktop` or `daemon` to release only one (see below)  |
| **bump**             | `patch` or `minor`, from the version on `main`                            |
| **notes**            | shown in the app's update dialog, so write them for the people reading it |
| **roll_out_desktop** | on by default: offer the release to every copy, and to new downloads      |
| **roll_out_daemon**  | on by default: each cloud machine installs it once no agent is busy       |

Or from a terminal:
`gh workflow run release.yml -f component=desktop -f notes="What changed, in plain words."`

The workflow runs the build and runtime checks from `heavy-tests.yml` (the browser suites
already ran on every pull request that reached `main`), commits the new version to `main` and tags
it, builds and publishes (Linux packages and a notarized Mac disk image for the desktop, a tarball
for the daemon), downloads what it published to check it, then rolls out: it sets
`DESKTOP_VERSION`/`DAEMON_VERSION` on the control plane and marks the desktop release Latest, which
is what the website's download button follows. If a build fails, "Re-run failed jobs" retries the
same version.

The desktop app and the daemon keep separate versions, so each is released only when it changed.
Installing a daemon restarts a machine's agents, so the control plane does it only while none is
working or waiting for an answer, or when the machine's owner presses Update now in the app.

**Roll out later, or roll back:** Actions → **Roll out** with the version to offer. It is the same
step the release ends with, and naming an earlier version rolls back to it.

What the app does with a release, and how the Mac build is signed, is in
[docs/desktop-releases.md](docs/desktop-releases.md). The workflow needs these repository secrets:
the five Apple ones listed there; `RAILWAY_TOKEN`, a project token for the production environment of
the `concors` project in the Holoworld AI Railway workspace; and `AUR_SSH_PRIVATE_KEY`, which
rolling out uses to publish `concors-bin` to the AUR (without it, that one step is skipped with a
warning).

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
