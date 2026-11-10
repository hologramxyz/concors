# Mobile polish audit — November 2026

This pass follows iOS App Review approval and addresses launch/reconnect messaging, the sidebar,
glass controls, Files gestures, conversation navigation, dictation, and drawer dismissal.
PDF preview feedback is included for both project files and chat attachments.
The changes are for review; they do not build, submit, or roll out a signed store release.

## Findings and fixes

| Finding                                                                                                     | Result                                                                                                                                                                                                                                                          | Verification                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The composer immediately announced “Reconnecting…” when its controls were briefly unavailable.              | The shell owns the delayed reconnect notice. Short reconnects remain quiet; sustained loss retains the read-only warning and recovery actions.                                                                                                                  | A new startup/reconnect regression advances the host through short and sustained interruptions; direct acceptance retains drafts across reconnects. |
| CPU/RAM appeared only after the sidebar opened, moving the navigation during its animation.                 | The resource row stays mounted with reserved space and a live subscription. Opening and closing the sidebar preserves the reading.                                                                                                                              | Real-daemon subscription checks and 320/390/430px geometry.                                                                                         |
| The machine selector was opaque, and the account entry filled the footer.                                   | Both are compact glass pills. iOS uses the existing native glass surface bridge; web/Android use backdrop blur. Machine emojis and cached account photos are preserved.                                                                                         | Native bridge interaction, managed account/machine editing, light/dark screenshots and corner-style regressions.                                    |
| Empty idle input showed a disabled Send action.                                                             | The primary action is Microphone for empty idle input, Send for text or attachments, Stop for an active empty turn, and Queue for a follow-up. The expanded toolbar avoids a duplicate microphone.                                                              | DOM state transitions, attachment-only submission state, and existing native dictation/bridge acceptance.                                           |
| “Latest” could sit underneath the floating native composer.                                                 | It uses the same measured footer inset as the conversation, including tasks, attachments, and queued messages.                                                                                                                                                  | Native bridge geometry at full phone height and a keyboard-sized viewport.                                                                          |
| Files and sidebar drags required long travel, and interrupted pointer capture could leave a partial offset. | A deliberate short flick can complete the transition. Wrong-direction starts and lost capture release cleanly; editor, horizontal strip, and vertical scrolling exclusions remain.                                                                              | Real touch tests against chat, terminals, directory rows, Markdown, and editor edges.                                                               |
| Drawers animated in but their handles could not dismiss them.                                               | Every compact `DialogContent` uses one touch implementation. Pulling down dismisses; short/cancelled pulls spring back. Scrolled content retains its gesture, inputs retain selection, nested sheets close independently, and a saving form can veto dismissal. | Shared drawer tests, cancellation, scroll arbitration, keyboard focus restoration and reduced motion.                                               |

PDFs now use the shared canvas renderer inside the bundled offline workspace. The removed mobile
placeholder was the reason PDFs asked to be opened on desktop. Chat attachment drawers now use the
same renderer and offer fit/zoom controls. Pages show rendering progress and explicit page-level
failures instead of an unexplained blank canvas. A twelve-page fixture checks real painted pixels,
phone widths, zoom, scroll/pan ownership, malformed files, and release of distant page bitmaps.
Mobile pages have a 4.2-million-pixel canvas budget each. Password-protected or damaged documents retain
an explicit error instead of a blank preview.

This raises the offline workspace script from about 3.69 MB to 5.43 MB (gzip: 1.17 MB to 1.69 MB).
The PDF modules initialize when a preview opens. No remote script, worker, or relaxed network policy
is added. Measure cold launch and PDF scrolling on the shipping iPhone before releasing the build.

The settings review also found that an older daemon could leave Subscriptions showing
“Connecting…” indefinitely. It now explains that the machine needs a Concors service update.

Native control geometry now also publishes when a panel transition ends or is cancelled. A busy
frame can exceed the normal tracking window; the final update prevents a glass button from staying
partly visible after its panel closes.

## Surface inventory

The visual suite captures each listed surface in light and dark at 390×844 with iPhone-style safe
areas. Settings also checks 320/390/430px widths. Other acceptance suites cover device-sized
layouts, shape preferences and live daemon behavior. Captures use the browser rendering of the
shared UI; they do not claim to be SwiftUI or physical-device screenshots.

| Surface           | Reviewed states                                                                                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry and startup | Welcome, saved account/machine restoration code, quiet transient reconnect, sustained disconnect recovery.                                                                                                                                                 |
| Conversation      | Approval, idle reply, shared Markdown/code/tool/diff/thinking/sub-agent rows, task progress, message history and Latest.                                                                                                                                   |
| Composer          | Collapsed microphone, expanded draft, model/provider/options controls, send/queue/stop states, attachments, recorded dictation and keyboard fallback.                                                                                                      |
| Navigation        | Header, tab strip, workspace picker, New tab, sidebar, search, machine/account/organization drawers, touch gestures and focus.                                                                                                                             |
| Terminal          | Shared terminal renderer, extra keys, panel navigation, input/session preservation.                                                                                                                                                                        |
| Files             | Capability explanation in demo; real directory tree, Markdown links, PDF pages and attachments, editor, explicit save, dirty guards and conflict recovery in direct acceptance.                                                                            |
| Resources         | Process list, filters, RAM/CPU, previews and stop confirmation.                                                                                                                                                                                            |
| Schedules         | List and new schedule page; real-daemon create/run/pause behavior in direct acceptance.                                                                                                                                                                    |
| Pull requests     | List, filters, workspace counts and detail; action confirmations exercised by fixture acceptance.                                                                                                                                                          |
| Settings          | Account, Appearance, Shortcuts, Notifications, Machines, Subscriptions, MCP servers, Plugins, SSH keys and About.                                                                                                                                          |
| Shared dialogs    | Account, organizations, machines, workspaces, new tabs, search, resources, message history, project setup, rename/icon editing and file confirmations share `DialogContent`. Native composer menus and iOS consent use the system `BottomSheet` primitive. |

Report and account-deletion preview pages are captured too. Route aliases (`/sign-in`, `/session`,
`/native-auth/callback`, and the legacy agents/settings links) reuse or redirect to the audited screens.

Production sign-in, account deletion, notification delivery, and native photo/document pickers
require their actual service and OS UI. This pass reviews their source and existing tests; it does
not change authentication, privacy permission, purchasing, or deletion contracts.

## Visual evidence

The contact sheets below are generated from the visual audit captures. Full-size images accompany
them in [mobile-polish/](mobile-polish/). The demo clearly labels its simulated behavior; live file
and resource behavior is checked separately against an isolated daemon.

64 screenshots cover 32 surfaces in both appearances. The final gallery uses a static production
JavaScript export in demo mode. All eight contact sheets were inspected; the review also caught
and removed duplicate route-name headers on Support and Delete account. Welcome captures wait
for the app image to decode so the dark appearance does not capture an unloaded logo.

| Group                                      | Light                                               | Dark                                               |
| ------------------------------------------ | --------------------------------------------------- | -------------------------------------------------- |
| Conversation and navigation                | [View](mobile-polish/light-navigation-overview.png) | [View](mobile-polish/dark-navigation-overview.png) |
| Workspace and drawers                      | [View](mobile-polish/light-workspace-overview.png)  | [View](mobile-polish/dark-workspace-overview.png)  |
| Every settings section                     | [View](mobile-polish/light-settings-overview.png)   | [View](mobile-polish/dark-settings-overview.png)   |
| Schedules, pull requests and account pages | [View](mobile-polish/light-pages-overview.png)      | [View](mobile-polish/dark-pages-overview.png)      |

[Full-size screenshot index](mobile-polish/README.md).

Live-daemon PDF evidence: [project preview](mobile-polish/pdf-project.png) and
[chat attachment preview](mobile-polish/pdf-attachment.png).

## Verification

- Formatting, ESLint and workspace type checking passed.
- All 75 phone acceptance cases were verified across bounded batches. The final production export
  passed the native panel-geometry check and both visual audits; affected standalone pages were
  recaptured after their header fix.
- 1,765 unit tests passed, with two opt-in integration tests skipped. This includes the latest
  native consent-drawer changes from main.
- Expo exports for iOS, Android and web passed. These are JavaScript/Hermes exports, not signed
  native application builds.
- All 32 direct-machine acceptance cases passed, covering chat, attachments, Files, PDFs, touch navigation, terminals,
  resources, search, schedules, history, reconnects and dirty-file/conflict guards.
- All five managed-machine tests passed, including account/machine changes, organization isolation
  and a terminal shared with desktop.
- Desktop PDF/image preview and zoom passed, as did shared dialog and focus regressions.
- A clean WebKit run also passed the real-daemon upload, PDF pixel-rendering and zoom checks.
  Cold file batches and first paints have a bounded 15-second allowance; pages show progress while
  their bitmap renders.

The PDF dependency emits `import.meta` warnings in the inline IIFE build for its Node/WASM-loader
branches; the browser PDF rendering and zoom checks pass. Rust checks were unavailable because
this Linux environment has no Cargo; this change contains no Rust edits.

## Before the next store build

Run the native acceptance on an iPhone with the shipping iOS version: pull each web drawer from its
handle and a list at its top, cancel a pull, scroll a long list, open a nested drawer, record/cancel/
edit dictation, and background/resume the app. Verify the two new glass buttons with VoiceOver and
Reduce Transparency, and check the software keyboard and interactive keyboard dismissal. Repeat
the drawer/keyboard smoke check on Android. Browser bridge tests cannot establish those native
rendering and gesture details.
