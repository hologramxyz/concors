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

Three CI jobs are **already failing on `main`** and are unrelated to whatever you are doing:
Workspace browser acceptance, Mobile browser (direct), Terminal runtime (windows-latest). Confirm a
failure exists on `main` before treating it as yours, and do not claim to have fixed them unless
you did.

Anything the shared UI imports from `@/tauri` must also exist in
`apps/desktop/src/mobile/native-platform.ts`. The mobile bundle aliases one to the other, and a
missing export there breaks mobile releases while every test still passes. Rebuild it with
`pnpm --filter @concors/mobile assets` after adding an export.

## Releasing the desktop app

The whole procedure, and what the app does with a release, is in
[docs/desktop-releases.md](docs/desktop-releases.md). In short:

```sh
pnpm desktop:version --set 0.3.0     # rewrites the four files that carry the version
cargo metadata --manifest-path apps/desktop/src-tauri/Cargo.toml --format-version 1 >/dev/null
```

Commit that, merge it to `main`, then tag the merge commit. **The tag's message becomes the release
notes people read in the update dialog**, so write it for them, not as a changelog:

```sh
git tag -a desktop-v0.3.0 -m "What changed, in plain words."
git push origin desktop-v0.3.0
```

CI builds it, installs the package in a clean Arch container to prove it is installable, and
publishes it. Nothing is offered to anyone until the control plane points at it:

```sh
railway variables --environment production --service concors-server --set "DESKTOP_VERSION=0.3.0"
```

Publishing and rolling out are separate on purpose, so a release can be held back. `DAEMON_VERSION`
is the same idea for the daemon that runs on cloud machines, released by the `daemon-v*` tag.

Two habits worth keeping, both learned the hard way:

- **The release workflow only runs on tags, so CI never exercises it.** Its container steps can be
  run locally with Docker; do that after changing them rather than finding out during a release.
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
