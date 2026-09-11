# Quality audit — 2026-09-11

Scope: desktop web UI, the shared phone-sized renderer/native bridge contract, API client,
daemon, and protocol. The audit branch started from `de30574` on main. Other open feature
branches are deliberately not included. Tests use isolated daemons, temporary projects,
and mocked account/billing/provider services, without changing live sessions or accounts.

This is a regression-focused audit, not a claim that every platform is defect-free.

## Areas exercised

Browser-driven interaction covered sign-in/restoration/sign-out; sidebar search and grouped
settings; appearance, custom palettes, corner styles and shortcuts; workspace folders, tabs,
split panes and terminal continuity; agent selection, streaming, approvals, attachments and
drafts; file browsing/editing/conflict recovery; machine selection and CPU/RAM freshness;
and mocked VPS billing success, decline and cancellation flows. Phone-sized checks also
exercise touch navigation, reduced-height composers, drawer focus restoration, native-bridge
contracts, reconnect recovery and shared desktop/phone sessions. Screenshots were inspected
for short authentication forms, long settings values, phone files, chat and theme surfaces.

This covers the checked-out app and its shared packages, not the separate marketing website,
production account lifecycle or unmerged feature branches.

## Confirmed issues fixed

| Issue                                                                                                               | Fix and regression evidence                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A late sign-out response could erase a newer sign-in; local credentials remained until the request finished.        | Capture the revocation credential, then clear local credentials immediately. Four unit cases cover delayed success, expired sessions, network failure, and immediate clearing.                                     |
| An older background file read could replace newer conflict/disk information.                                        | Ignore superseded file checks. A deferred-read regression preserves the draft and latest disk revision. Server-side revision checks remain unchanged.                                                              |
| Short windows clipped the authentication form.                                                                      | Preserve centering when it fits and allow vertical scrolling when it does not. Browser coverage exercises sign-in and sign-up at 640×320.                                                                          |
| Missing or denied clipboard access could throw outside the UI's error handling or retain a stale success indicator. | Use a rejecting async clipboard wrapper and recoverable copy feedback. Unit coverage includes missing APIs, receiver binding, synchronous throws and rejected promises; browser coverage checks failure and retry. |
| Long account details forced settings content beyond its frame.                                                      | Allow values to wrap while reserving readable label space. Browser coverage checks account/organization details at 1280, 800 and 640px.                                                                            |
| A damaged text attachment could crash the workspace during rendering.                                               | Decode inside the preview's error handling and cache only successful results. Browser coverage injects truncated data, closes the error, and successfully retries without losing the conversation.                 |

The mobile baseline also confirmed mismatched workspace/native safe-area colors after
the color-theme change. The host and renderer now share a phone background resolver,
preserving the original light/dark surfaces and using the selected palette's background.
Named-theme terminals use the same canvas unless a custom theme explicitly overrides
terminal colors. Passing regression coverage includes switching palettes, custom files,
and falling back after a custom file is removed.

The second pass confirmed two more recovery issues in the file editor and provider
settings. Transient polling warnings now clear when reads recover, without clearing or
replacing failed-save feedback. File drafts and provider form edits are preserved.
Three additional file-state unit tests and two browser scenarios cover recovery and
verify that a rendered refresh cannot make an unsuccessful save appear successful.

The final pass exposed lost keyboard focus when cancelling a project dialog opened from
a menu. A focused regression failed three times before the fix. Desktop cancellation now
returns to the actual opener (workspace menu or empty-state button); successful setup does
not run that cancellation handler. Coverage exercises both Close and Escape, then continues
by keyboard. The mobile drawer's existing focus handling is unchanged.

Each runtime fix is a separate commit with its regression coverage. Separate test-only
commits update intentional provider-picker/attachment-preview UI expectations and wait
for dialog focus restoration before typing into a terminal. No product shortcut behavior
was changed to address the test timing race.

The browser CI job budgets were increased from seven to fifteen minutes in a separate
commit: the complete local suites took about 7–10 minutes, before CI dependency setup.
No checks were removed, and this does not resolve the separate account billing blocker.

## Audit passes

- Initial pass completed (started at 07:52 UTC).
- Second pass completed at 11:21 UTC (started at 10:52 UTC), adding two confirmed recovery fixes.
- Final pass completed at 14:27 UTC (started at 13:52 UTC), fixing project-dialog focus recovery and repeating final validation.
- Follow-ups are part of the active audit session, not a permanently installed scheduler.

## Validation

- Workspace unit suite after the fixes: 530 passed, one optional live-API integration test skipped.
- Final workspace typecheck and repository lint/format checks passed.
- Final desktop web and daemon builds passed, as did the bundled mobile renderer and JavaScript/Hermes exports for web, Android and iOS.
- Isolated Linux daemon bundle smoke passed: version, health, workspace, terminal input/output, resize and stop.
- Desktop acceptance: all 58 scenarios passed in a clean full run during the final pass (8.2 minutes), including project-dialog cancellation. The second pass also had a clean 57-scenario run (8.1 minutes). Attachment recovery passed three repeats,
  and all three shortcut scenarios passed three repeats after explicit focus synchronization.
- Phone-size browser suites: 37 passed (26 demo/native bridge, 10 direct-daemon, one managed phone/desktop integration). All 10 direct-daemon scenarios passed again during the second pass (4.4 minutes); all 26 demo/native-bridge scenarios (6.9 minutes) and the managed integration (29.6 seconds) passed again in the final pass. The initial demo baseline had 25 passes and one confirmed theme failure; all 26 passed after the fix.
- An earlier full desktop run finished with 54 passes and one interrupted reload (8.3 minutes).
  Its trace shows Chromium `ERR_NETWORK_CHANGED` failures loading app modules; the app did not
  mount. The unchanged palette/reload scenario then passed three separate repeats, followed
  by the clean full-suite run above. No app behavior or assertions were changed for that interruption.
- The first final-pass desktop run had 56 passes and the project-dialog focus failure described above.
  After its fix, all three cancellation repeats and nine shortcut checks passed. One of three
  separate project-flow repeats was interrupted by Chromium `ERR_INSUFFICIENT_RESOURCES`
  on reload; the other two passed. That interrupted batch is not reported as all-green;
  the fresh 58-scenario desktop run above subsequently passed without interruption.

## Requested chat cleanup after review

Three additional, separate UI commits remove the connected-provider/email badge,
the import/fork/rewind/MCP action toolbar, and the composer's Commands picker.
The unused session-action component is deleted. Authentication, provider credentials,
daemon session APIs, typed slash commands, and model/effort/permission controls are unchanged.
Native composer menus also stop listing commands; their remaining conversation options stay.

Fresh validation after this cleanup: 530 unit tests passed (one optional live-API test
skipped), all workspace type checks and repository lint/format checks passed, and the
desktop web build passed. Eight focused desktop browser scenarios and both mobile
provider-switching scenarios (web composer and native-bridge contract) passed.
The new browser regression explicitly advertises session tools, MCP status and a
compact command, then verifies their controls are absent at desktop and narrow widths
and after reload. Screenshots confirm the connected-account identity is absent.

An initial test-only assumption that the ephemeral account backend retained login on
reload failed; the reload regression now explicitly models an existing CLI login.
Real sign-in interactions still exercise the account backend for all three supported
account providers. The clean eight-scenario run followed that test correction.
The larger full-suite totals above describe the preceding audit, not a full rerun
after these UI removals. The CI billing and native-device limitations below still apply.

## Follow-up: infinite history and direct agent startup

Requested follow-up commits add automatic backward/forward chat scrolling and a
240-message window on compatible daemons, with visible-message anchoring, retry
feedback, and stale-page protection across history revisions. New agent panes open
with the existing default provider/model without an initial chooser. The same
implementation is also applied to mobile PR #62; its flat-tab changes are preserved.
See [chat history](chat-history.md) for protocol compatibility and behavior details.

Fresh audit-branch validation: 542 unit tests passed (one optional live-API test
skipped), workspace type checks and lint/format passed, and desktop web/daemon
bundles built successfully. The mobile renderer also built during type checking.
The full desktop browser run had 58 passes and three 30-second timeouts under
heavy VPS load (swap was full). A serial eight-scenario recheck passed every
affected case, so all 61 distinct desktop scenarios passed across those runs;
this is not presented as a clean single-run result. Three longer chat journeys
now have a 60-second test budget; their assertions are unchanged. The resource
usage tests passed again without any timeout or product changes.

Focused mobile web/native-bridge history and provider-switching scenarios also
passed on the audit branch. Mobile PR #62 receives its own branch-specific
verification and preserves its dependency on PR #58. Hosted CI and physical-device
validation remain separate requirements.

## Remaining validation boundaries

### Verification after merging message navigation from main

Merged main at `35b2c0f` (PR #61) into both follow-up branches. Message-index jumps
now fetch bounded context on either side, retain live prompt entries while reading
older history, and distinguish the current window's bottom from the actual tail.
Mobile keeps its flat tabs/account drawer and receives main's color-theme provider.

- Audit branch: 550 unit tests passed, with one optional live-API test skipped.
- Mobile branch: 548 unit tests passed, with the same optional skip.
- Both branches passed workspace type checks and repository lint/format checks.
  The final desktop controller tests passed again after the jump-context adjustment.
- Desktop web and daemon bundles passed; the mobile renderer built during type checks.
- Eight focused desktop browser scenarios passed across the merge checks, including
  three account providers, composer controls, chat cleanup, both history viewport
  widths, and main's message-navigation journey. The final three-scenario history/
  navigation run passed cleanly (1.2 minutes).
- The initial merge browser run had six passes and two test targeting failures:
  a hidden phone rail was queried as visible, and a subpixel tick was targeted in a
  641-message rail. The long-history test now uses the full-size message list on both
  widths; the separate rail test still verifies pointer and keyboard interaction.
  No history or navigation assertions were removed.

### Platform and service limits

- Chromium browser fixtures exercise the mobile bridge contract, not actual SwiftUI, Android,
  WebKit/Safari, device keyboards, native accessibility, signing, push, or OS lifecycle behavior.
  The physical-device matrix in [the mobile release runbook](mobile-release.md) still applies.
- Native desktop platform builds were not run locally: the required Rust/platform toolchains
  are not available in this audit environment.
- Billing/auth tests use controlled fixtures, not real purchases, production credentials,
  or an end-to-end production account lifecycle.
- The optional dependency advisory scan is awaiting approval to send dependency metadata
  to the registry. This audit does not assert dependency-vulnerability clearance.
- Both the repository's main CI and this PR's CI did not start any job steps because of an account
  payment/spending-limit blocker. Local results do not replace the unexecuted native CI
  checks; no billing settings or CI bypasses were changed.
- The web build still emits its existing large-chunk warning. Passing builds and interaction
  checks do not establish production performance budgets or a long-duration load-test result.
