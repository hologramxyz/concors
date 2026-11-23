# Webhook triggers

Webhook triggers let CI, Sentry, bots and other tools send data to a chat and start a run without
opening Concors. Public webhooks are available on **cloud machines only** for now; local gateways
do not expose them. This release provides the daemon protocol; configuration UI comes separately.

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
normal human approval requirements. Webhooks never elevate the chat's permissions.

Accepted events return `202 {eventId,status,sessionId}` before asynchronous delivery. Busy chats
receive a queued follow-up, not an interrupt. Prompt items show `Webhook · <source>` and carry
daemon-only trigger/event metadata. Inspect `trigger.list` for the latest 50 events and errors.
`delivered` means the prompt was handed to the agent, not that its task succeeded.

## Limits and recovery

- 64 triggers per machine; 64 KiB raw body (`413` above this).
- 30 events per minute per trigger (`429` above this).
- Idempotency keys: up to 256 characters, last 200 keys within 24 hours per trigger. Repeated keys
  return `200` with the original event ID and current result; a changed body does not run again.
- Unknown IDs and incorrect secrets both return `401`; disabled triggers return `409`.
- An uncertain in-flight delivery after restart becomes failed and is not replayed. Already
  persisted agent-queue entries remain in the chat queue.

The URL alone is not a credential. Treat its bearer secret like a password; rotation immediately
invalidates the old secret. TLS terminates at the managed gateway, which forwards only hook
credentials and source/idempotency headers to the private host. Other machine endpoints still
require machine JWT authentication. Never place secrets in the body, query string or logs.
Remove or deliver queued events before deleting a trigger; its receipts supply queued prompt labels.
