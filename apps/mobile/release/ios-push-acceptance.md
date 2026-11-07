# iPhone push rollout and acceptance

Requested November 7, 2026. **Delivery is not yet verified.** Android credentials and Firebase are
outside this iPhone rollout. Push is now in the requested iOS release scope; the previous
“excluded from first release” evidence no longer approves submission.

## Configuration checked

- Expo `@guitong35/concors`, project `b928233e-14cd-4e58-95e5-b19d8101bcb6`.
- Apple bundle `xyz.hologram.concors`, paid team `9WN4P724M2` (Rolling Inc.). Apple reports
  `PUSH_NOTIFICATIONS` enabled. Its App Store provisioning profile includes
  `aps-environment: production`; verify this in the new signed executable too.
- A dedicated Concors APNs key must be assigned in Expo. The existing Heist APNs credential was
  not reused. Apple's cached Developer session expired; the operator must sign in privately to
  generate and save the new key. The EAS Submit and Sign in with Apple keys are separate credentials.
- Server PR 26 is deployed at `85618cb9bcb066b6964e98bfc8ecd216802ed422`.
  `PUSH_NOTIFICATIONS` was false at the configuration check. Pier will enable it after credentials
  and the native build are ready. `EXPO_ACCESS_TOKEN` is only required if enhanced Expo push
  security is enabled; verify the project setting before activation.
- The isolated `concors-app-review` machine reports daemon `0.14.0`; its gateway and session host
  are active. Real AI access for that reviewer machine remains a separate open requirement.
- The full native build includes `@expo/ui` 57.0.26. The `production` profile correctly refused to
  build while App Review gates are incomplete. Use the `candidate` profile for TestFlight QA;
  it shares the paid-team store signing, production environment and native dependencies.
- [Website PR 16](https://github.com/hologramxyz/concors-web/pull/16) discloses push data and choices.
  Confirm the deployed policy before enabling collection. Existing Device ID / app functionality
  privacy declarations cover optional push identifiers; Privy still requires its analytics purpose.

## Physical acceptance — pending

Install the new native build in TestFlight. Keep passwords, push tokens and keys out of screenshots,
chat and repository records. Use a company test machine and an account authorized to access it.

1. Confirm the production API advertises `pushNotifications: true` after the flag is enabled.
2. Sign in, open Settings → Notifications, enable Push notifications, and allow iOS notifications.
   Confirm the switch remains enabled after reopening the app. A denial must leave the rest of
   the workspace usable and explain how to enable permission later.
3. Send an agent a prompt on a cloud or connected machine running daemon 0.14.0 or later, then
   lock the phone. Confirm **Agent finished** and `A chat on <machine name> is done.` arrive.
4. Tap the alert while the app is backgrounded and again from a terminated launch. Confirm the
   expected account, machine and chat open once. Verify no cross-account navigation after switching
   accounts and no private prompt/code/file content in the lock-screen payload.
5. Exercise **Agent needs your input** and **Agent stopped** with controlled test work. Confirm the
   corresponding alerts and chat routing. The app intentionally suppresses foreground banners.
6. Disable push in Concors and verify new events do not notify that installation. Re-enable, then
   sign out and verify that session's registration is removed. Check account switching and, on a
   disposable account, account deletion. Revoke iOS permission, reopen the app and confirm its
   registration is reconciled. Other opted-in devices must remain independent.
7. Record the build, UTC time, machine, event kind and observed result. If an alert is missing,
   inspect the server send outcome and Expo receipt privately. The current sender handles immediate
   Expo ticket errors but does not poll downstream receipts or retry transient Expo sends. An Expo
   accepted ticket is not proof of delivery to APNs or the phone.

Do not mark the push release gate verified until these outcomes are recorded. A synthetic transport
probe can help isolate credentials, but does not verify a real daemon event or an agent conversation.

References: [Expo setup](https://docs.expo.dev/push-notifications/push-notifications-setup/),
[Expo delivery and receipts](https://docs.expo.dev/push-notifications/sending-notifications/),
server `docs/push-notifications.md`, client `docs/mobile-backend.md`.
