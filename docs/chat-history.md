# Chat history and default startup

New agent panes wait for a provider: the empty composer shows **Select a provider** and its
menu lists the machine's enabled providers, including ones not installed yet (choosing one of
those offers its install). The chat starts once one is picked, with that provider's remembered
model, and the composer then shows the resolved model name and lets the user switch provider or
model. A daemon without `provider-settings` cannot list its providers, so its new chats still
start on the daemon's default provider.

Chat prose and desktop/native composer text use Paseo's default 15px content size
with 21px line spacing; code uses its 12px size. These values follow
`packages/app/src/styles/theme.ts`, `styles/markdown-styles.ts`, and
`composer/input/input.tsx` at Paseo revision `d7c7044`. Mobile web inputs retain
16px to avoid Safari zooming the viewport on focus.

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
- The sent-message navigator can jump to either side of the current window. It
  fetches bounded context around the selected prompt, then resumes automatic
  scrolling. New prompts stay indexed while the reader is viewing older history.
- When the left message rail is visible, the duplicate top-right message-list
  button is hidden. Narrow panes retain the list as their history navigator.

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
