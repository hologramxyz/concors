# Chat primitives: implementation audit

September 11, 2026. This extends the [provider audit](unified-chat-parity-audit.md)
beyond compaction and session controls. It compares Concors at `f61d75c` with
[Paseo `d7c7044`](https://github.com/getpaseo/paseo/tree/d7c7044dfc91d1d18721dc8757ac3bb913d8c232).
The implementation also incorporates main through `007d27d`, including account
sign-in, machine selection, and empty Codex thread recovery.

The earlier fixes did not establish full chat-primitive parity. Some provider
messages reached the daemon but lost their structure before reaching the client.
This follow-up fixes those paths in the shared desktop/mobile chat.

## Findings and resulting behavior

| Primitive                 | Audit finding                                                                                      | Result                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task lists                | ACP plans became text; Claude/OpenCode task tools did not consistently produce task cards.         | Canonical pending/in-progress/completed steps, active labels, successful ID-based TaskCreate/TaskUpdate/TaskList updates, and empty-list clearing.                                                                                 |
| Restored task state       | Task mutations after reconnect could lack their earlier IDs.                                       | Native history rebuilds task state before later updates; failed tool calls do not advance tasks.                                                                                                                                   |
| Plan proposals            | A Codex proposal had no implementation action; Claude ExitPlanMode appeared as a command approval. | Current, completed Codex plans have **Implement plan**. Claude shows the proposal with approve/request-changes/cancel choices. Both leave planning mode while keeping ordinary tool approvals.                                     |
| Single-choice questions   | Choice semantics and cancellation were incomplete.                                                 | Keyboard-operable radio choices, visible descriptions, required answers, custom answers only where allowed, dismiss and cancel.                                                                                                    |
| Multiple-choice questions | Invalid or duplicate selections could reach the provider.                                          | Checkbox choices and server-side cardinality, option, duplicate and question-ID validation before consuming the request.                                                                                                           |
| Text/editor questions     | Pi editor prompts lost prefill, multiline input and optional-empty semantics.                      | Prefill, placeholders, multiline editing, preserved indentation/newlines and optional blanks; explicit dismissal maps to native cancellation.                                                                                      |
| Yes/No questions          | Pi confirmations looked like tool execution approvals.                                             | Ordinary confirmations use Yes/No questions; Concors's tool hook retains separate approval semantics.                                                                                                                              |
| Secret answers            | Response summaries could expose answers.                                                           | Masked input and redacted shared timeline summaries. Private daemon request receipts still hold submitted values; this is not a claim of secret-free disk storage.                                                                 |
| Asynchronous questions    | Codex async question messages had no usable form.                                                  | Nonblocking forms survive later turns and daemon restart. Answering/dismissing persists a resolution marker atomically with the receipt and any follow-up queue entry. Replayed native messages do not reopen a resolved question. |
| Permission scopes         | Native session/persistent grants were collapsed or lost.                                           | Preserve the exact native action, with distinct once/session/always/rule labels. No implicit promotion to a broader grant.                                                                                                         |
| Plan/mode approvals       | Request type and plan text were missing.                                                           | Explicit review cards with native action labels and request detail. Unsupported native actions are not invented.                                                                                                                   |
| MCP elicitation           | Typed forms existed, but generic response validation needed to match question handling.            | Supported scalar/enum/multiselect fields validate before response; URL flows remain explicit links, with decline/cancel. Unsupported field types fail visibly.                                                                     |
| File reads                | Read content was presented as an empty diff.                                                       | Read cards display the actual provider-returned content and keep the file-opening action.                                                                                                                                          |
| Writes/edits              | New-file content and some native metadata disappeared.                                             | Show provider diffs or supplied edit/write snippets; preserve native output if no diff is available. Snippets are not represented as inferred whole-file changes.                                                                  |
| Shell and search          | Some ACP output was lost.                                                                          | Render command stdout, search results, native file locations and referenced terminal output as it arrives.                                                                                                                         |
| Thinking                  | Several adapters discarded public thinking events or used the wrong shape.                         | Provider-emitted thinking text streams and restores into its own expandable card. Opaque/redacted blocks and signatures are excluded. This does not generate or infer hidden reasoning.                                            |
| Sub-agents                | Some child status messages were dropped.                                                           | Keep child status and supplied messages; native child history remains capability-gated and read-only.                                                                                                                              |
| Notices/retries           | Pi notices and retry activity were lost.                                                           | Surface native notices, visible custom messages and retries. Hidden custom messages remain hidden.                                                                                                                                 |
| Attachments               | Sent files became names only in history.                                                           | New messages show attachment chips. Images and text/JSON/XML can be previewed after reconnect or daemon restart. Bytes are fetched explicitly from the owning session's saved request, not broadcast with every timeline update.   |
| Cancellation              | Multiple kinds of pending input need different native responses.                                   | Dismiss/deny does not silently mean “approve.” Cancel interrupts the turn. External resolution removes the form; later replies are rejected.                                                                                       |
| Cross-client state        | Needs-input attention could be lost when work continued.                                           | Pending asynchronous input retains attention while the turn runs. Answered forms disappear on connected clients. Working/done/failed/interrupted state follows native lifecycle events.                                            |

## Existing primitives rechecked

Markdown, code blocks, copy controls, clickable project-file links, scroll-follow,
paginated history, composer drafts, model/effort/mode controls, commands, skills,
context usage, compaction, interruption, durable queues, import/fork/rewind/steer,
and MCP server status remain part of the shared client. Their availability comes
from the provider, rather than showing controls that cannot work. See the
[provider capability matrix](unified-chat-provider-support.md#native-capabilities)
for the transport-specific operations and previous native CLI probes.

Main's empty Codex thread recovery is retained: an explicitly missing empty
thread can be replaced after sign-in/restart. A thread with saved provider
history is not discarded, and failed prompts are not replayed.

## Intentional differences and limits

- Codex async answers use Concors's durable follow-up queue. They are delivered
  after the active turn; they do not silently steer or interrupt current work.
  After Stop/failure/daemon restart the queue stays paused until resumed. The
  question card explains this delivery model. Paseo can steer an active turn.
- Blocking native permission requests cannot survive a dead provider process.
  They are retired on interruption/restart; Concors never replays an approval.
  Async questions can survive because they do not depend on a live RPC resolver.
- Native task snapshots and plan proposals are different primitives. Updating a
  task list does not automatically approve an implementation plan.
- Native history imported from outside Concors may not contain retrievable
  attachment bytes. Binary-format downloads, generated-image galleries and
  automatic attachment cleanup are outside this change. Text/code previews are
  rendered as text, and SVG/HTML attachments are not executed.
- Pi/OMP custom rendered extension UIs and arbitrary plugin views are not
  implemented. Supported questions, confirmations, editors, notices and native
  controls use the shared interface. Unsupported UI requests are canceled.
- MCP form support is a bounded primitive subset, not a general JSON Schema form
  engine. Nested objects and arbitrary custom widgets are not supported.
- Provider quota dashboards, a general plugin runtime and portable dictation
  remain separate features. No claim is made that all optional ACP accounts were
  authenticated, or that browser tests certify physical iOS/Android behavior.

## Evidence

Reference paths inspected in the pinned Paseo source include `agent-types.ts`,
`question-form-card-core.ts`, Claude `task-state.ts` and `agent.ts`, Codex
`async-questions.ts` and its app-server adapter, OpenCode's adapter, Pi's extension
UI mapping, OMP custom-message handling, and ACP plan/permission mapping.

Regression coverage lives in:

- `packages/daemon/src/agents/questions.test.ts`: required/optional/custom/secret
  handling, cardinality, editor whitespace, native permission action identity.
- `packages/daemon/src/agents/providers/plans.test.ts`: canonical tasks, native
  history, restored task IDs, read content and exclusion of opaque thinking data.
- `packages/daemon/src/agents/providers/adapters.test.ts`: actual adapter protocol
  boundaries for Claude plans/questions, OpenCode grants/rejection/reasoning,
  Pi editors/confirmations/cancellation, and ACP plans/thinking.
- `packages/daemon/src/agents/sessions.test.ts`: real daemon transport, concurrent
  clients, invalid/stale replies, cancellation, async question restart/dedup,
  current-plan implementation, saved attachments, and merged Codex recovery.
- `e2e/chat-primitives.spec.ts`: visible desktop forms, plan review, file reads and
  attachment preview after reload. Account sign-in and existing chat flows are
  checked separately.
- Mobile PR `apps/mobile/e2e-direct/direct.spec.ts`: the same forms, dismissal,
  plan approval and file reads at phone width, alongside the existing real
  daemon and native-bridge acceptance scenarios.

Final integration: **483 repository tests passed**, one opt-in API test skipped.
Five desktop browser scenarios and all nine direct mobile scenarios passed; the
phone chat scenario passed again after the final fixture integration. Workspace
type checks, lint and formatting passed. The built daemon passed the relocated
bundle smoke check (version, health, workspace and PTY operations).

Tests using controlled providers verify Concors's mapping and UI. They are not
claims of successful inference on every provider subscription. GitHub Actions
has an external pre-start billing/spending-limit blocker; local validation and
native-device validation are reported separately in the PRs.
