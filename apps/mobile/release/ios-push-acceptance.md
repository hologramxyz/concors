# iPhone push rollout and acceptance

Requested November 7, 2026. **Completion delivery and tap-to-chat were confirmed by the owner on
November 8 using TestFlight 0.1.0 (16).** The owner also confirmed no completion alert arrived while
push was disabled in Concors. See [the device report](ios-build-16-device-acceptance.md).
The owner [accepted this rollout and deferred further push tests](ios-push-owner-acceptance.md).
Additional physical scenarios below are optional follow-up coverage. Android credentials and Firebase are
outside this iPhone rollout. Push is now in the requested iOS release scope; the previous
“excluded from first release” evidence no longer approves submission.

## Configuration checked

- Expo `@guitong35/concors`, project `b928233e-14cd-4e58-95e5-b19d8101bcb6`.
- Apple bundle `xyz.hologram.concors`, paid team `9WN4P724M2` (Rolling Inc.). Apple reports
  `PUSH_NOTIFICATIONS` enabled. Its App Store provisioning profile includes
  `aps-environment: production`; the [build 16 signed executable](ios-build-16.md) has the same
  production entitlement.
- A dedicated **Concors Push Production** APNs key is assigned in Expo, restricted to production
  and the Concors topic. Apple terminal sign-in was renewed privately; other Apple keys are
  unchanged. See [November 8 activation](ios-push-activation.md). The EAS Submit and Sign in with
  Apple keys remain separate credentials.
- Server PR 26 is deployed at `85618cb9bcb066b6964e98bfc8ecd216802ed422`.
  `PUSH_NOTIFICATIONS=true` is now deployed and the authenticated production API advertises
  `pushNotifications: true`. `EXPO_ACCESS_TOKEN` is only required if enhanced Expo push security is
  enabled; that project setting was rechecked disabled on November 8. Production deployment and
  readback are in [the activation record](ios-push-activation.md).
- The isolated `concors-app-review` machine reports daemon `0.14.0`; its gateway and session host
  are active. Real AI access for that reviewer machine remains a separate open requirement.
- [Full native build 16](ios-build-16.md) includes one `@expo/ui` 57.0.26 module, shared by the app
  and router after [PR 188](https://github.com/hologramxyz/concors/pull/188). The `production` profile correctly refused to
  build while App Review gates are incomplete. Use the `candidate` profile for TestFlight QA;
  it shares the paid-team store signing, production environment and native dependencies.
- [Website PR 16](https://github.com/hologramxyz/concors-web/pull/16) discloses push data and choices.
  Its merged policy is live at https://concors.dev/privacy. Existing Device ID / app functionality
  privacy declarations cover optional push identifiers; Privy still requires its analytics purpose.

## Automated acceptance — passed

Seventeen focused regressions passed: three routing, one mobile Personal Team restriction, five
managed-daemon attention, two Expo sender and six real disposable-Postgres registration, recipient,
deduplication, rate-limit and cleanup tests. The disposable database container was removed afterward.
After the UI dependency fix, mobile typechecking and all 222 mobile tests passed. Both PR 187 and
PR 188 passed all 19 repository CI checks before merging. These tests do not establish APNs delivery.

## Physical coverage — owner accepted rollout; additional scenarios deferred

The owner confirmed completion-alert delivery and navigation to the correct chat in response to the
locked-phone test below. That covers the completion delivery in step 3 and the observed tap in
step 4. In a follow-up test, no completion alert arrived while push was disabled in Concors, covering
the first opt-out check in step 6. Backgrounded and terminated navigation were not separately
reported. The API capability in step 1 is verified in [the activation record](ios-push-activation.md).
Other scenarios below were not physically verified, including re-enrollment, off-setting persistence and
registration removal; these owner observations do not establish server-side cleanup or independence
of other installations.

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

The push gate records [the owner’s acceptance](ios-push-owner-acceptance.md), based on the actual
configuration and device evidence above. The deferred matrix does not block further App Store
preparation. A synthetic transport probe does not verify a real agent conversation or phone delivery.

References: [Expo setup](https://docs.expo.dev/push-notifications/push-notifications-setup/),
[Expo delivery and receipts](https://docs.expo.dev/push-notifications/sending-notifications/),
server `docs/push-notifications.md`, client `docs/mobile-backend.md`.
