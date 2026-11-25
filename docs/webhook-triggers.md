# Webhook triggers

## In the app

Open **Webhooks** beside **Schedules** in the sidebar (on desktop or mobile). It appears when the connected daemon supports webhook triggers. Create a trigger, choose a chat or Supervisor, and select whether to keep context or start a new chat for each event. You can edit, enable, disable, delete, or rotate a trigger from its card. Expand **Recent events** to see delivery status and open the chat that received an event. Chat prompts are marked **From webhook · source**.

Creating a trigger or rotating its secret opens connection details with copy buttons for the cloud machine's URL, the one-time secret, and a curl command. Save the secret before closing: it is shown only once. Local machines still allow trigger management, but have no public webhook URL; external delivery requires a cloud machine.

Webhook triggers let CI, Sentry, bots and other tools send data to a chat and start a run without
opening Concors. Public webhooks are available on **cloud machines only** for now; local gateways
do not expose them.

Clients negotiate `webhook-triggers-v1`, then use `trigger.request` with `list`, `create`, `update`,
`delete` or `rotate`. Mutations other than create require `expectedRevision`. Create and rotate
return `outcome.secret` once. Save it securely: retries return the current trigger list without
the secret, and the daemon stores only its SHA-256 hash. Rotate again if the response was lost.

A definition has a name, projectId, optional-in-content prompt (use `""` for no instructions),
target, mode and enabled flag. Targets are a session ID, an agent provider/model, or `supervisor`.
Supervisor uses `projectId: null` and only `same` mode; open a Supervisor chat before delivery.
Other targets require a project folder. In `same` mode the conversation is reused; `new` creates
a fresh conversation per event, copying the provider/model for a session target.

```sh
curl -X POST https://<machine-hostname>/hooks/<id> \
  -H "Authorization: Bearer $SECRET" \
  -H "Idempotency-Key: abc" \
  -H "X-Concors-Source: stream" \
  -H "Content-Type: application/json" \
  -d '{"note":"..."}'
```

JSON is pretty-printed when the formatted result fits 64 KiB; otherwise the original JSON is
preserved to avoid expansion from deeply nested data. All other payloads are text. Source can also be supplied as `?source=`
and defaults to the trigger name. Labels are sanitized to 40 characters. The prompt is followed
by an explicitly untrusted, fence-neutralized data block. This framing is defense in depth, not a
guarantee against prompt injection: only connect trusted senders, review their payloads and keep
normal human approval requirements. Webhooks never elevate the chat's permissions, and they are
not delivered to chats that run without approvals (Claude's Bypass permissions, Codex's Full
access): such an event fails with a message saying so, checked when it is delivered, since a
chat's mode can change after its trigger was made. The Supervisor can be a target, with a warning
in the form: it can start and direct other chats, so only trusted senders should reach it.

Accepted events return `202 {eventId,status,sessionId}` before asynchronous delivery. Busy chats
receive a queued follow-up, not an interrupt. Prompt items show `Webhook · <source>` and carry
daemon-only trigger/event metadata. Inspect `trigger.list` for the latest 50 events and errors.
`delivered` means the prompt was handed to the agent, not that its task succeeded.

## Limits and recovery

- 64 triggers per machine; 64 KiB raw body (`413` above this).
- 30 events per minute per trigger (`429` above this).
- 100 events waiting for a chat per trigger (`429` above this), so a chat that stopped taking
  prompts, waiting on an approval say, cannot have events pile up without bound.
- Idempotency keys: up to 256 characters, last 200 keys within 24 hours per trigger. Repeated keys
  return `200` with the original event ID and current result; a changed body does not run again.
- Unknown IDs and incorrect secrets both return `401`; disabled triggers return `409`.
- An uncertain in-flight delivery after restart becomes failed and is not replayed. Already
  persisted agent-queue entries remain in the chat queue. The visible queue stays within the
  existing 20-follow-up limit; additional webhook events wait durably in the trigger store and
  enter the chat queue as space becomes available, including after restart. Queue previews are
  bounded to 16,000 characters; delivery and steering retain the complete webhook prompt.
  A queued event missing from both the persisted chat queue and trigger overflow after restart
  becomes delivered if its provider-accepted prompt is saved in chat history, otherwise failed
  without replay, rather than remaining stuck as queued.

The URL alone is not a credential. Treat its bearer secret like a password; rotation immediately
invalidates the old secret. TLS terminates at the managed gateway, which forwards only hook
credentials and source/idempotency headers to the private host. Other machine endpoints still
require machine JWT authentication. Never place secrets in the body, query string or logs.
Remove or deliver events already admitted to a chat's queue before deleting their trigger; its
receipts supply queued prompt labels. Trigger-owned overflow that has not entered that queue is
cancelled by deletion and does not block it. Temporary admission refusals (such as a chat being
forked) stay in trigger-owned overflow and retry automatically. Refusals while the target chat or
workspace is unavailable are recorded as failed. A same-chat trigger stays attached to its
specific conversation: after switching providers, deliveries to the hidden conversation fail
instead of silently moving to the other provider or blocking later events. Switch back to that
conversation or edit the trigger's target before sending more events.
