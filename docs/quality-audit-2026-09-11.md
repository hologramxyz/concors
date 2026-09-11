# Quality audit — 2026-09-11

Scope: desktop web UI, the shared phone-sized renderer/native bridge contract, API client,
daemon, and protocol. The audit branch started from `de30574` on main. Other open feature
branches are deliberately not included. Tests use isolated daemons, temporary projects,
and mocked account/billing/provider services, without changing live sessions or accounts.

This is a regression-focused audit, not a claim that every platform is defect-free.

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
- Final pass is planned around 13:52 UTC.
- Follow-ups are part of the active audit session, not a permanently installed scheduler.

## Validation

- Workspace unit suite after the fixes: 530 passed, one optional live-API integration test skipped.
- Final workspace typecheck and repository lint/format checks passed.
- Final desktop web and daemon builds passed, as did the bundled mobile renderer and JavaScript/Hermes exports for web, Android and iOS.
- Isolated Linux daemon bundle smoke passed: version, health, workspace, terminal input/output, resize and stop.
- Desktop acceptance: all 57 scenarios passed in a clean full run during the second pass (8.1 minutes). Attachment recovery passed three repeats,
  and all three shortcut scenarios passed three repeats after explicit focus synchronization.
- Phone-size browser suites: 37 passed (26 demo/native bridge, 10 direct-daemon, one managed phone/desktop integration). All 10 direct-daemon scenarios passed again during the second pass (4.4 minutes). The initial demo baseline had 25 passes and one confirmed theme failure; all 26 passed after the fix.
- An earlier full desktop run finished with 54 passes and one interrupted reload (8.3 minutes).
  Its trace shows Chromium `ERR_NETWORK_CHANGED` failures loading app modules; the app did not
  mount. The unchanged palette/reload scenario then passed three separate repeats, followed
  by the clean full-suite run above. No app behavior or assertions were changed for that interruption.

## Remaining validation boundaries

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
