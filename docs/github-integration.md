# GitHub repositories

GitHub connects to the individual Concors account and follows the owner across managed VPSs. Account → Integrations provides Connect, Add account or organization, Reconnect, and Disconnect. Clone repository offers a personal/organization repository picker and a pasted URL option.

Deploy the matching concors-server GitHub integration first. Its `docs/github-integration.md` describes the one-time GitHub App registration, environment variables, migration, credential helper, and deployment acceptance. This client never receives or stores a GitHub access token. Local computers continue using their existing Git credentials.

The picker loads repositories in pages of 100. Search filters loaded repositories; Load more retrieves the next page. A connected managed VPS is prepared before cloning; GitHub SSH clone URLs become HTTPS so the machine credential helper can authenticate Git.

## Validation

`pnpm test:github:e2e` builds the desktop web client and runs the three GitHub browser scenarios against intercepted assets, mocked GitHub API responses, and one disposable daemon on port 7430. It starts no Vite server, does not alter the shared main preview, and does not access real GitHub repositories. The clone scenario checks the submitted GitHub URL then substitutes an isolated local Git repository at the daemon boundary, verifying the clone opens a workspace.

Unit tests cover URL normalization, per-machine preparation, public/local/third-party behavior, API session authentication, and preparation errors. Browser tests cover account connect/disconnect, personal and organization selection, filtering, retry, cloning, and a narrow layout. Live authorization and private clone/fetch/push on multiple VPSs remain a deployment acceptance check once the GitHub App is registered.

Connection onboarding continues from GitHub authorization directly into GitHub’s account/repository installation chooser. **Add account or organization** lets users grant more access later. Account settings show the installed accounts; both settings and the repository picker refresh when returning from GitHub, including all installation pages. Each organization must grant installation access (or approve a member’s request); membership alone does not grant the app repository access. If GitHub only offers the app owner’s account, make the app public in its Advanced settings.
