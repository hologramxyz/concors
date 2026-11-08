# Build 16 — owner push confirmation

Recorded November 8, 2026 from the owner's response to the physical iPhone test for TestFlight
**0.1.0 (16)**. The requested test was to enable push in Concors and allow iOS permission, send an
agent a short task on a connected/cloud machine, lock the phone, and tap the completion alert.

The owner reported: **“Alert arrived and opened the correct chat.”** This confirms completion-alert
delivery and navigation to the intended chat in the tested flow, after the
[production push activation](ios-push-activation.md).

In a follow-up test on the same build, the owner was asked to disable Push notifications in Concors,
run another short agent task and lock the phone. The owner reported: **“No alert arrived while push
was off.”** This confirms the in-app push-off control suppressed the completion alert in the tested
flow. Re-enrollment after enabling push again, persistence of the off setting, removal of the server
registration and behavior on other installations were not separately reported.

The responses do not identify the device model, iOS version, machine, exact event time or whether
the app was backgrounded or terminated when the alert was tapped. November 8 is the confirmation
date, not a measured delivery timestamp. No push token, account identifier or private task content
is included in this record.

Needs-input and error alerts, a separate terminated-app launch, duplicate navigation, lock-screen
payload inspection, denied permission, enrollment persistence, sign-out, account switching,
account deletion and iOS permission withdrawal were not physically tested.
See [the remaining checklist](ios-push-acceptance.md).

The owner subsequently [accepted the push rollout and deferred further push tests](ios-push-owner-acceptance.md).
The push gate records that acceptance without claiming untested scenarios passed. Other
[App Store submission requirements](submission-packet.md) remain independent; public App Review has
not been submitted.
