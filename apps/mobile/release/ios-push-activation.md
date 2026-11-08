# iPhone push activation — November 8, 2026

Configuration verified **2026-11-08T00:48:30.654Z**. **Real-phone push delivery remains unverified.** The dedicated
Apple credential is assigned in Expo, production push is enabled, and the authenticated API
advertises it. Build **0.1.0 (16)** remains available in Internal TestFlight. Public App Review is
not submitted.

| Area                     | Verified state                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Apple team / bundle      | Rolling Inc. `9WN4P724M2` / `xyz.hologram.concors`                                                                                |
| APNs credential          | Dedicated **Concors Push Production**, production environment, topic-specific                                                     |
| Allowed topic            | `9WN4P724M2.xyz.hologram.concors` only                                                                                            |
| Existing Apple keys      | Preserved; no Heist or shared team key was reassigned, edited or revoked                                                          |
| Expo assignment          | `@guitong35/concors`, project `b928233e-14cd-4e58-95e5-b19d8101bcb6`, matching paid team and bundle                               |
| Bundle capability        | Push Notifications enabled; [build 16](ios-build-16.md) has signed `aps-environment=production`                                   |
| Expo push security       | Enhanced push security disabled; `EXPO_ACCESS_TOKEN` is not required for the inspected setting                                    |
| Server rollout           | Production `concors-server`, `PUSH_NOTIFICATIONS=true`                                                                            |
| Deployed revision        | `85618cb9bcb066b6964e98bfc8ecd216802ed422`                                                                                        |
| Deployment               | `db041e57-6ed7-4088-8c42-3ef3615540d5` / `SUCCESS`                                                                                |
| Authenticated capability | `GET /api/v1/mobile/capabilities` returned HTTP 200 and `pushNotifications: true`                                                 |
| Privacy                  | https://concors.dev/privacy includes optional push identifiers, Expo/Apple delivery, machine-name previews, choices and retention |

The owner completed Apple sign-in privately in the workspace terminal. The existing EAS helper
creates team-wide keys, so the new credential used Apple's topic-specific production configuration
to restrict it to Concors. Apple readback confirms exactly that topic and environment. Expo readback
confirms assignment to the production Concors app. The private key and authentication session values
remain outside Git and this record; no password or verification code was requested in chat.

The server rollout changed only `PUSH_NOTIFICATIONS` for this production service. Railway redeployed
the existing backend revision above; no backend source change or Android/Firebase setup was needed.
The production API was checked with the isolated reviewer account after deployment. Build 16 already
contains the native UI update and production push entitlement; this server-side credential assignment
does not change that signed executable. Its TestFlight processing/group/draft state was rechecked.

## Phone acceptance still required

On the physical iPhone, install TestFlight **0.1.0 (16)**, sign in, open Settings → Notifications,
enable Push notifications and allow iOS permission. Send work to an authorized connected/cloud
machine running daemon 0.14.0 or later, then lock the phone. Verify completion, needs-input and error
alerts, and tap each to the correct chat. Also check opt-out, sign-out, account switching and
permission withdrawal as described in [the acceptance checklist](ios-push-acceptance.md).

Seventeen focused automated push regressions and all 222 mobile unit tests/typechecking passed
before this configuration rollout; the previous UI/readiness PRs passed all 19 CI checks each.
These are not physical APNs delivery evidence. The push release gate stays blocked until actual
phone delivery, navigation and revocation results are recorded. The current server handles immediate
Expo ticket errors but does not poll downstream receipts; accepted tickets do not prove phone delivery.

References: [Apple APNs key scopes](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns),
[Expo receipts](https://docs.expo.dev/push-notifications/sending-notifications/).
