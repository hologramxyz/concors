# Build 16 — owner Apple sign-in report

Recorded November 8, 2026 from the owner's response to the physical iPhone check for TestFlight
**0.1.0 (16)**. The requested flow was Continue with Apple, choose Hide My Email if offered, and
confirm a signed-in Concors screen.

The owner reported: **“Apple sign-in returned to Concors successfully.”** This records the
successful return observed on the device. The response does not separately identify the selected
email option, device model, iOS version, exact event time or Apple authorization screens shown.
No password, verification code, account identifier or authorization token is included here.

The subsequent [aggregate production check](ios-apple-sign-in-production-check.json) matched the
live service's database configuration and found existing Privy accounts, but no Apple-linked
Concors account, stored revocable Apple authorization or Apple-linked identity in the production
Privy project. No identities or token values were included in the result. This does not disprove
the reported screen transition; it leaves completion of a production Apple authorization
unestablished. An existing browser/app session or another environment could explain the result,
but neither explanation has been confirmed.

The initial clarification request has been superseded by the
[independent operator investigation and deployed fix](ios-apple-auth-self-test.md). No additional
owner questionnaire or device test is pending. The production-auth hold now records the remaining
unobserved real Apple consent/grant exchange, rather than waiting for an answer about the original
screen transition. Hide My Email selection, cancellation and actual personal Apple authorization
revocation are not separately claimed as physically tested.
