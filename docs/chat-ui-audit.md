# Composer and timeline audit

Historical snapshot of the initial Codex UI integration. For current behavior,
read [Agent interface](agent-interface.md) and [provider support](unified-chat-provider-support.md).

The initial integration covered provider icons, model and thinking controls,
permission and plan modes, attachments, context usage, draft and queue behavior,
Markdown and code highlighting, expandable tools, task cards, elapsed time, and
completion state. Provider capabilities determine which controls are available.

Browser acceptance exercised clipboard copying, uploads, expandable details,
task panels, queued follow-ups, reload, and a 390px viewport. Daemon tests covered
native settings, plan transitions, unavailable-tier rejection, and synchronized
settings. Source provenance is recorded in [third-party notices](../third-party/source-notices.md).

Closing a pane detaches its view without stopping the session. Workspace source
packages are excluded from Vite prebundling so changed schemas reach development
clients immediately.
