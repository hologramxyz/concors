# Mobile parity audit — September 2026

Baseline: desktop `main` at `40c53c6` (including merged mobile #92 and Linux desktop #93).
This audit distinguishes the checked-out app from the static preview: the preferred
private preview was still serving #62 (`18b6c2c`). Merging desktop or mobile source does
not rebuild an already-exported Expo preview.

## Surface audit

| Surface                       | Implementation and outcome                                                                                                                                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace sidebar             | Uses desktop `WorkspaceSidebarItem`, `useProjectIcons` and `ProjectImage`. Repository favicons travel through the daemon; repositories without an icon use their initial, non-repositories use a folder. Covered by the direct-daemon favicon scenario.                                  |
| Agents                        | Uses desktop `AgentSidebar`, `ProviderIcon` and `AgentLoadingIcon`. Working/starting overlays a small spinner on the provider mark. Mobile suppresses hover-only tooltips; provider-switching and live working-state browser checks cover the shared rows.                               |
| Profile                       | Uses shared `AccountAvatar` and account-menu components with a mobile drawer. Fixed the direct-preview bridge dropping the image and added the same read-only GitHub identity lookup as desktop. Tests ensure no profile tokens/passwords reach the renderer or daemon.                  |
| Sign-in                       | Corrected visible Concourse branding, including shared account/auth copy. Existing bundle IDs, URL scheme, package names and API domains are unchanged. No invented user identity: a direct preview shows Your profile until optional account sign-in.                                   |
| Agent conversation            | Imports desktop `ChatPane`, timeline, Markdown, tool presentations, approval/question forms and history navigation. No obsolete connected/import/fork/rewind/MCP toolbar. Both DOM and native-bridge provider/history scenarios exercise the current renderer.                           |
| Composer                      | Shares agent/model/effort/permission and send/interrupt behavior. Supported iOS uses Expo UI/GlassEffect over the WebView; web/Android use the shared DOM controls. Browser contract tests do not prove physical keyboard or glass rendering.                                            |
| Files                         | Uses desktop `FilesProvider`, `FileTree`, `FileTypeIcon`, file tabs, Markdown and editor. Existing scenarios cover colored extension icons, cached folder listing, editing, save conflicts, draft guards and touch navigation.                                                           |
| Tabs and terminals            | Mobile deliberately flattens desktop panes into the Tabs drawer; IDs, split siblings and running sessions remain shared. No desktop split/arrange UI. Direct and managed tests exercise shared sessions.                                                                                 |
| Search and workspace creation | Uses desktop machine-scoped workspace/agent/tab search, shared setup/clone/project actions and mobile drawer presentation. Search is not file-content or message-content search.                                                                                                         |
| Settings, teams and machines  | Reuses desktop account, appearance, provider, terminal profile, SSH and shortcut views where applicable. Managed tests cover avatar, organization switching, isolation, GitHub and machine metadata. Direct preview intentionally has no cloud organization/billing/provisioning access. |
| Navigation and resource usage | Retains mobile sidebar/files swipe arbitration, rounded glass rim, bottom drawers, and sidebar CPU/RAM. Browser tests cover gestures, hidden controls, themes and telemetry fallback.                                                                                                    |
| Onboarding                    | Removed AI-sharing screen, stored-consent dependency and withdrawal controls with no replacement page. Authentication, private-endpoint checks, organization isolation and ordinary privacy links remain.                                                                                |

## Preview verification

`pnpm --filter @concors/mobile assets` recompiles the desktop renderer. The offline
document now includes a `concourse-source-revision` meta tag containing the checkout
commit (`-dirty` for tracked uncommitted changes). EAS archives use their supplied
commit if Git metadata is unavailable; otherwise the stamp explicitly says `unknown`.

For private preview updates, export with `--clear` and the intended environment/base
path, then inspect the served iframe's stamp against the commit being tested. Verify
the rendered sidebar, profile, chat and files as well as the HTTP response. Retain the
previous export for rollback and preserve the daemon proxy and unrelated routes.

## Deliberate differences and remaining acceptance

This is desktop feature reuse with mobile navigation, not identical desktop layout.
Native iOS keyboard, dictation, accessibility, glass and background/resume behavior still
need installed-device testing. Safari preview testing cannot establish those results.
The audit also found and fixed a shared telemetry regression: repeated missing samples
could restart the initial grace period forever. Both clients now stop checking after the
initial timeout and show unavailable immediately when a real reading is lost.

Production account, push/deletion and store-review evidence remains tracked in the
release packet; this audit does not mark those gates verified. Removing the AI-sharing
page is a product change, not a claim of storefront approval.
