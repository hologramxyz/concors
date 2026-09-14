# Dialog titles

Dialogs use a compact 16px, medium-weight title through the shared `DialogTitle` component. Mobile drawers use the same size. Keep title text separate from supporting descriptions and do not add larger local heading overrides.

The title audit covers shared workspace forms and confirmations, pane/tab shortcuts, command search, machine creation and editing, provider and terminal settings, account/settings drawers, files, attachments, message history, and session pickers. The separate React Native profile/sign-in sheet uses `Screen presentation="dialog"`; ordinary full-page screens keep their larger headings. Native OS alerts retain system-managed typography.

Secondary VPS step headings are smaller than the main modal title. Header actions such as Refresh belong in `DialogContent.headerActions`, beside the standard Close control. Reserve enough header space for those controls and retain 44px mobile touch targets.

Browser regressions cover centered desktop bounds, narrow layouts, keyboard and pointer dismissal, focus restoration, mobile drawer sizing, profile-sheet headings, and the shared resume picker in web-composer and native-host bridge modes.
