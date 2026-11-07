# Social sign-in recovery — November 6, 2026

[Server PR 24](https://github.com/hologramxyz/concors-server/pull/24) clears partial Privy sessions
before retrying social sign-in and prevents duplicate provider starts.
[Server PR 25](https://github.com/hologramxyz/concors-server/pull/25) avoids revocation requests
when the browser has no session to clear. Backend commit
`94eac0c0158c5ebea954bb54808900622f8c42dc` deployed successfully to production.

Four component regressions cover partial-session recovery, duplicate retry taps, cleanup failure
and an empty browser session. The server suite passes 490 tests; 54 database-dependent tests
remain skipped. TypeScript, lint, formatting and the production build pass.

At 22:02 UTC, three fresh browser contexts with an iPhone user agent reached GitHub authorization
through the normal production sign-in page without browser alerts or provider HTTP errors. No
GitHub account authorization was completed. The generated reviewer account separately passed the
normal production email-code flow and PKCE exchange at 21:55 UTC. Its isolated machine remained
connected and the same running terminal survived the backend deployment.

The exact original error on the owner's Privy screen was not captured. Successful GitHub login
on the signed iPhone still needs confirmation; these checks do not establish that the original
first-attempt failure cannot recur. Apple account sign-in, private email, OAuth-token return and
revocation also remain signed-device acceptance checks.

[Client PR 180](https://github.com/hologramxyz/concors/pull/180) fixes repeated AI-sharing prompts.
Seventeen focused regressions pass, including seven simultaneous conversation restores,
reconnection during a prompt, saved approval and withdrawal, configuration changes, pending
storage writes and large provider registries. All 19 repository CI checks pass, as does CI on the
merged application revision `1bfc77273fd39a85e84057eb0a63150e2c233504`.

On November 7, the owner confirmed that TestFlight 0.1.0 (13) shows one AI-sharing prompt and
remembers approval across several conversations and closing/reopening the app.
[Owner device confirmation](ios-build-13-device-acceptance.md) records that result and its limits.
The owner has not yet tested GitHub sign-in on this build; its device acceptance remains pending.

App Store submission remains blocked on the other recorded release gates. No public review was
submitted by these changes.
