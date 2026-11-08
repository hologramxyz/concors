# Build 16 — owner push confirmation

Recorded November 8, 2026 from the owner's response to the physical iPhone test for TestFlight
**0.1.0 (16)**. The requested test was to enable push in Concors and allow iOS permission, send an
agent a short task on a connected/cloud machine, lock the phone, and tap the completion alert.

The owner reported: **“Alert arrived and opened the correct chat.”** This confirms completion-alert
delivery and navigation to the intended chat in the tested flow, after the
[production push activation](ios-push-activation.md).

The response does not identify the device model, iOS version, machine, exact event time or whether
the app was backgrounded or terminated when the alert was tapped. November 8 is the confirmation
date, not a measured delivery timestamp. No push token, account identifier or private task content
is included in this record.

Needs-input and error alerts, a separate terminated-app launch, duplicate navigation, lock-screen
payload inspection, denied permission, enrollment persistence, opt-out, sign-out, account switching,
account deletion and iOS permission withdrawal still require their own physical acceptance evidence.
See [the remaining checklist](ios-push-acceptance.md).

The composite push gate remains blocked until those checks are complete. This confirmation does
not complete the other [App Store submission requirements](submission-packet.md); public App Review
has not been submitted.
