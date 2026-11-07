# Build 13 — owner device confirmation

Recorded November 7, 2026 from the owner's response about TestFlight **0.1.0 (13)**.
The owner confirmed that AI sharing shows one permission prompt and remembers the choice when
opening several conversations and closing/reopening the app. This confirms the reported repeated
prompt defect is resolved in that tested flow.

The owner has **not yet tested GitHub sign-in** on this build. The original Privy failure is still
awaiting device verification after the deployed retry fixes.

This report does not verify force-quit/session restoration, network reconnection, a change of
account or machine, changed provider configuration, declining consent or withdrawal. Those
scenarios need their own acceptance evidence. No device model or iOS version was provided.

The other App Store release checks remain open, including Apple sign-in and token revocation,
reviewer AI access, reporting operations and remaining device acceptance. This report does not
mark the composite release gates complete.
