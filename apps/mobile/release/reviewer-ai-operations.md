# Reviewer AI access — November 8, 2026

The owner authorized an existing Hologram/Ava API key. A working Anthropic key from the authorized
Hologram server environment now supplies the isolated `concors-app-review` machine. No subscription,
new provider account, or change to the source application's credentials or billing was needed.

In **Task Notes → Review agent**, **Pi 1.5.0** uses **Claude Haiku 4.5**
(`claude-haiku-4-5-20251001`). Production account access, a real AI reply, approved README read,
approved file write and generated-file readback passed. Workspace, terminal tests and reconnect
also passed. These checks do not claim a reviewer-account login on a physical iPhone.

The company key is held by a separate system service. The agent runs as `ubuntu`, without sudo or
read access to that credential file. A separate administrative user retains verified operator SSH
access. No company key is in the app, repository, screenshots or Apple's review instructions.

## Allowance and operation

The [service](../scripts/app-review-ai-proxy.mjs) listens only on `127.0.0.1:43189`. Pi supplies a
review-local token; the service supplies the company key. It accepts only the pinned model, text
and custom tools, at most 64 KiB per request and 2,048 output tokens. It removes cache controls and
options for separately billed hosted features.

The durable ledger reserves **$0.25 per allowed request before sending**, without refunding failures
or disconnected streams. **80 requests per UTC calendar month** provide a conservative **$20 review
allowance** at [Haiku 4.5's published prices](https://platform.claude.com/docs/en/about-claude/pricing).
This limits review traffic locally; it does not change the shared provider account's limits.
Hosting remains $5.35/month, within the approved $30 total. Reserved allowance is not actual invoiced
spend. Regression tests cover request limits, durable quota exhaustion, month rollover, SDK beta-query
routing and rejected requests that must not spend.

`concors-review-ai.service` runs the daemon's bundled Node executable against
`/opt/concors-review-ai/proxy.mjs`. Private configuration is at
`/etc/concors-review-ai/credentials.json`, readable only by root and the service account. The ledger
is `/var/lib/concors-review-ai/budget.json`; restarts preserve it. Inspect it through the operator
account. Never log credentials, request bodies or full SDK error context.

After review, disable the service/local token, remove the VM's credential copy, detach the machine,
cancel renewal and destroy the VPS/backups. Verify billing stopped. The upstream key remains in use
by Hologram; remove this deployment's access without revoking the shared source key.
