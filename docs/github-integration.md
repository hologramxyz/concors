# GitHub repositories

GitHub connects to the individual Concors account and follows the owner across managed VPSs. Account → Integrations provides Connect, Add account or organization, Reconnect, and Disconnect. Clone repository offers a personal/organization repository picker and a pasted URL option.

Deploy the matching concors-server GitHub integration first. Its `docs/github-integration.md` describes the one-time GitHub App registration, environment variables, migration, credential helper, and deployment acceptance. This client never receives or stores a GitHub access token. Local computers continue using their existing Git credentials.

The picker loads repositories in pages of 100. Search filters loaded repositories; Load more retrieves the next page. A connected managed VPS is prepared before cloning; GitHub SSH clone URLs become HTTPS so the machine credential helper can authenticate Git.

## Mobile

The companion shares Account integrations, profile photos and the two-step repository picker.
Its host explicitly allowlists GitHub status, connect/disconnect, account/repository pages and
machine preparation; no GitHub token, account token or generic fetch crosses into the renderer.
Managed clones pass the selected control-plane machine ID, not the daemon's workspace ID.
Returning from the system browser refreshes an initiated GitHub flow via a scoped foreground event.
Direct-daemon previews have no cloud account access: Clone opens the URL/path form and uses Git
credentials on the connected desktop. Existing server GitHub deployment requirements still apply.

`pnpm test:mobile:managed` covers account photos, connect/disconnect, repository browsing and
managed-machine preparation with mocked APIs and isolated real daemons. It stops private cloning
at a deliberate preparation error; live OAuth and private repository operations still need a
configured GitHub App and a non-customer test account. `pnpm test:mobile:direct` also checks that
direct cloning makes no cloud GitHub requests. These browser checks are not native-device evidence.

## Validation

`pnpm test:github:e2e` builds the desktop web client and runs the four GitHub browser scenarios against intercepted assets, mocked GitHub API responses, and one disposable daemon on port 7430. It starts no Vite server, does not alter the shared main preview, and does not access real GitHub repositories. The clone scenario checks the submitted GitHub URL then substitutes an isolated local Git repository at the daemon boundary, verifying the clone opens a workspace.

Unit tests cover URL normalization, per-machine preparation, public/local/third-party behavior, API session authentication, and preparation errors. Browser tests cover account connect/disconnect, personal and organization selection, filtering, retry, cloning, and a narrow layout. Live authorization and private clone/fetch/push on multiple VPSs remain a deployment acceptance check once the GitHub App is registered.

Connection onboarding continues from GitHub authorization directly into GitHub’s account/repository installation chooser. **Add account or organization** lets users grant more access later. Account settings show the installed accounts; both settings and the repository picker refresh when returning from an initiated GitHub setup flow, including all installation pages. Ordinary window focus does not invalidate the picker. Each organization must grant installation access (or approve a member’s request); membership alone does not grant the app repository access. If GitHub only offers the app owner’s account, make the app public in its Advanced settings.

Clone repository uses two steps: select a GitHub repository (or paste a URL), then confirm the destination folder, defaulting to `~/repos/<repository>`. The dialog keeps a fixed viewport height, reserves list space during initial loading, and retains rows during manual refresh and transient refresh errors. Back preserves the selection, search, and scroll position. GitHub account reconnection/disconnection stays in Account settings; the clone picker has compact access and refresh controls.
