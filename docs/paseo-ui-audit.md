# Paseo composer and timeline audit

**Historical snapshot of the initial Codex UI port.** For current provider
coverage and behavior, read the [unified chat parity audit](unified-chat-parity-audit.md)
and [agent interface](agent-interface.md). Subsequent changes added Claude Code,
OpenCode, and Pi, removed model refresh from the picker, and moved drafts into
connection-scoped memory. The results below describe the earlier implementation.

Reference: `getpaseo/paseo` at `a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6`.
This audit covers the Agent pane, composer, and conversation rendering. It does not
mean the entire Paseo application or every provider adapter has been imported.

| Area                          | Reference inspected                                                                              | Result in Concors                                                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pane identity and activity    | Provider icons; sidebar activity                                                                 | Imported Codex SVG. Pane header overlays the same loading component as the sidebar only for starting/working. Removed the duplicate model/status/duration bar.                                                                                                                 |
| Compact controls              | `composer/agent-controls/index.tsx`, `control.tsx`, `glyph.tsx`, `layout.ts`, `mode-control.tsx` | 28px icon controls with searchable, keyboard-accessible popovers. No native select arrows or separate model refresh glyph. Refresh lives inside the model picker.                                                                                                              |
| Model branding                | `components/provider-icons.ts`, `icons/codex-icon.tsx`                                           | Provider logo on the closed model picker and model options; model names remain in the open picker and tooltip. The current structured provider is Codex.                                                                                                                       |
| Thinking and permission icons | `agent-controls/icons.ts`, protocol provider manifests                                           | Brain; Shield for default; ShieldCheck for auto-review; ShieldOff for full access. Shift+Tab cycles permission modes for the next message.                                                                                                                                     |
| Plan and speed options        | Codex provider collaboration-mode/model catalogs and turn parameters                             | Real Plan mode and catalog-provided speed controls. Settings synchronize. Plan uses the native plan workflow and read-only sandbox; disabling it restores default workflow. Unsupported controls stay absent.                                                                  |
| Task tracking                 | `composer/task-list/index.tsx`, `components/plan-card.tsx`                                       | Collapsible task panel above input, per-step states, counts, Markdown plan rendering, copy plan. Interrupted tasks stop spinning.                                                                                                                                              |
| Context meter                 | `components/context-window-meter.tsx` and utilities                                              | Ported ring geometry, usage colors, compact token formatter, and pending footprint. Click reveals used/max/cumulative usage; no invented costs or rate limits.                                                                                                                 |
| Input                         | Composer submit, attachment, input, and dictation modules                                        | Existing queue/retry behavior retained. 16px input, file/paste/drop support, dictation controls, connection/read-upload feedback. Removed permanent keyboard/permission hints and outer composer divider.                                                                      |
| Loading and shimmer           | `components/message.tsx` expandable badge shimmer                                                | Ported web text-shimmer pattern; reduced-motion fallback. Added requested braille activity indicator (the inspected Paseo checkout does not contain a braille spinner). Streaming and tool activity stop with authoritative completion/interruption.                           |
| Markdown and code             | `components/highlighted-code-block.tsx`, `utils/highlight-cache.ts`, `packages/highlight`        | Direct dependency on `@getpaseo/highlight@0.7.2`; imported cached tokenization and language aliases. Highlighting loads lazily, falls back to plain code, respects light/dark themes, and never injects raw HTML. 16px prose; larger headings, tables, lists, and blockquotes. |
| Copy actions                  | Highlighted code block and message copy behavior                                                 | Copy message, code, tool output, diff, plan, and child-agent update. Code copy strips the final fence newline. Success and clipboard failure are visible.                                                                                                                      |
| Tool presentation             | Tool display/detail/icon helpers and Codex tool-call mapper                                      | Imported icon resolver alongside existing Paseo display helpers. Expandable shell output, file diffs with copy controls, separate MCP input/result sections, search icon, thinking summaries, expandable child updates.                                                        |
| Scrolling                     | Timeline tail behavior                                                                           | Existing near-bottom follow behavior retained; content resize now follows lazy-rendered code while preserving manually scrolled history.                                                                                                                                       |

## Explicit remaining differences

These are integrations beyond the current Codex pane port, not hidden functional
buttons: Claude/OpenCode structured provider adapters, provider-wide usage/rate
limits, provider discovery/install diagnostics, skills/file-mention catalogs,
server-persisted reusable agent profiles, rewind/fork operations, and portable
native voice/transcription. Browser dictation is available where the browser
implements speech recognition. Drafts/queued messages remain local to the mounted
composer. Child agents have inline activity rather than separate navigable chats.
Paseo's git/diff workspace panels, terminal tracks, and repository navigation are
outside this composer/timeline audit.

## Validation

Browser acceptance checks icon selectors, keyboard-capable search, 16px input,
pane overlay only while running, actual CSS shimmer and reduced-motion fallback,
plan/speed selections, syntax tokens and real clipboard copying, uploads,
expandable details, task panel, queued follow-ups, reload, and a 390px viewport.
Daemon tests verify native workflow/speed parameters, read-only planning, leaving
Plan mode, unavailable-tier rejection, and settings synchronization.

Pane profile changes detach the view binding without stopping its agent or terminal.
The previous session remains discoverable. Workspace source packages are excluded
from Vite prebundling so changed schemas reach the development client immediately.
