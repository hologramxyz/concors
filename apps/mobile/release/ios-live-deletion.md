# Production deletion and reporting — November 8, 2026

Verified **2026-11-08T01:54:02.886Z** using one disposable Privy identity, operator-created Concors
account/session fixtures and an external-machine record with no real host, DNS or paid resource.
The saved reviewer account and machine were unchanged.

- Stale sessions and changed deletion plans were rejected; a fresh session and matching plan
  scheduled deletion through the public production API.
- Both sessions were invalidated immediately. The real worker completed deletion of the Privy
  identity, Concors user, organization, machine record, sessions, account links and support reports.
- Only the minimal completed-status receipt remained, with no user ID.
- A synthetic private support report was received, read by the operator and resolved.

The sessions were seeded for this probe. It does not establish normal sign-in, the native
reauthentication UI, Apple OAuth revocation or erasure of an actual billed cloud server. Existing
disposable-database lifecycle/cleanup tests cover shared-resource handling and cloud cleanup
ordering. No customer records or servers were used for the destructive check.

The owner chose **Rolling Inc. / gm@hologram.xyz** for support. Ongoing triage is an operator
responsibility; this check proves intake/resolution without claiming automatic mail forwarding or
continuous monitoring.
