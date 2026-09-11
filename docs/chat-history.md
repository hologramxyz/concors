# Chat history and default startup

New agent panes start with the daemon's existing default provider (Codex) and its
machine-default model. The composer still lets the user select a different provider
or model; there is no initial chooser screen.

Desktop and mobile use the same conversation controller and scroll behavior:

- Scrolling near the top loads earlier messages automatically.
- Scrolling near the bottom loads newer messages that were trimmed from the window.
- Up to 240 messages stay in the current window on a bidirectional-capable daemon.
  Loading one edge can evict the opposite edge; persisted history is not deleted.
- A visible-message anchor preserves the reading position when pages are inserted
  or evicted. Streaming follows the bottom only when the user is already there.
- New replies do not insert a disconnected tail while the user is reading old history.
- The optional Latest control returns to the actual newest page, including when
  another history request is pending.
- Failed page loads preserve the existing messages and show an explicit retry action.
  They do not automatically loop on an unavailable connection.
- History revision changes invalidate pending reads before reloading the current
  transcript, so truncated history cannot reappear from a late response.

The read protocol accepts either an exclusive `before` or `after` position, not both.
Responses remain limited to 80 items and the existing payload-size budget. `hasMore`
describes older history; optional `hasNewer` both describes newer history and signals
forward-paging support. Older daemons retain automatic backward loading without
evicting loaded messages or sending unsupported forward requests. Updating the daemon
enables the bounded, bidirectional window.

Regressions cover both directions, payload-limited pages, duplicate requests, streaming,
stale reads after truncation, failures/retry, legacy responses, and visible-message
anchoring at desktop and phone widths. Mobile direct-daemon checks exercise the web
composer and native-bridge contract; they do not replace physical-device testing.
