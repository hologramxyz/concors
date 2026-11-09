# Apple sign-in — independent verification, November 8, 2026

[Server PR 27](https://github.com/hologramxyz/concors-server/pull/27) fixes three reproduced browser
failures and a production API acceptance gap. [The result record](ios-apple-auth-self-test.json)
identifies the merged source and successful Railway deployment.

Privy reports a restored browser session through the same completion callback as a fresh login.
Concors accepted that callback before clearing the old session. The live API also accepted the
isolated reviewer's email identity for an Apple-selected attempt and issued a working Concors
session without Apple authorization. That controlled probe session was signed out and verified
invalid. This reproduces a possible cause of a successful app return with no Apple-linked account;
it does not establish the exact steps taken on the owner's phone.

The fix ignores restoration-only callbacks, waits for the actual OAuth callback on return, uses
that callback's current user while waiting for Apple tokens, preserves the grant through an added
email-verification step, and rejects an Apple-selected attempt without an Apple identity.

## Tests completed

- All **563 backend tests** pass with all five disposable Postgres suites enabled; no database
  tests are skipped. Formatting, lint, type checking and the production build pass.
- Three browser regressions fail before the fix and pass afterward. Eight recovery/completion
  cases now pass, including a restored session on the OAuth return page.
- Six Apple/Postgres cases exercise private relay email, PKCE, encrypted grant storage, returning
  identities, missing/invalid/mismatched grants, added email verification, and revocation
  failure/retry before Privy identity and database deletion. Provider boundaries use fakes and
  locally signed identity tokens; no production account is deleted by this suite.
- After deployment, the same live wrong-provider probe returns `apple_authorization_required`
  and issues no Concors session.
- A real production Privy SDK/browser test first authenticates the isolated reviewer by email,
  then starts Apple in another page with that browser session present. A fresh Apple authorization
  request is required, with the correct Concors client/callback and zero premature Concors
  completion calls. No Apple account credentials are entered.
- Normal production reviewer email login and PKCE exchange still pass, with one connected review
  machine and no observed Privy HTTP errors.

The hosted sign-in page and API deliver these fixes to **TestFlight 0.1.0 (16)**. Mobile native
code is unchanged, so no replacement native binary or reinstall is required for these fixes.

## Scope and remaining verification

The owner's successful device return remains recorded in
[the device report](ios-apple-sign-in-device-acceptance.md). The operator has independently tested
restored-session handling, provider selection and the grant lifecycle. A real personal Apple
account consent and Apple-issued grant exchange were not completed by the operator; simulated
provider responses are not presented as that evidence. The production-auth gate remains blocked
on that unobserved provider exchange. There is no pending owner questionnaire or additional
device-test request. Public App Review remains unsubmitted.

## November 9 live Apple page check

The operator repeated the provider start using the normal production Concors page and Privy SDK
with both a fresh browser and an existing isolated reviewer session. This time Apple's actual
authorization page was loaded without intercepting or replacing it. Both cases requested the
configured Concors client and Privy callback, displayed the Concors name, produced no provider
HTTP errors, and made zero premature Concors completion calls. A desktop browser check also
confirmed the fully loaded Apple account field was enabled and could receive focus.

[The readback](ios-apple-auth-live-browser.json) records these checks without account identifiers,
credentials, OAuth state, or token values. These are live browser checks up to Apple's account
entry screen, not a completed native sign-in. No Apple-authenticated user session is available to
this browser, so real consent, Hide My Email, and the resulting Apple-issued grant exchange remain
unverified. Expo and Apple Developer API access do not provide that user authorization.

A separate token-endpoint diagnostic used only random invalid refresh tokens. Apple returned
`invalid_grant` for both the deliberately invalid client proof and the configured proof. This
negative control did not distinguish valid client authentication, so the diagnostic is recorded
as inconclusive. It is not treated as successful credential validation or a real user sign-in.
