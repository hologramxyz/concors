# Previews and Resources

The sidebar's Previews section is automatic. There is no add, edit, or remove action.
The daemon checks listening ports with a bounded `HEAD /` probe and promotes only
HTTP(S) responses that look like browser content or redirects. It does not show
agents, daemon infrastructure, arbitrary TCP listeners, or CPU/RAM values. A
positive or negative probe is cached for ten seconds; process identity and port
ownership still refresh every three seconds while the sidebar is mounted.

Clicking a local preview opens its loopback URL. A managed VPS opens an authenticated
per-port hostname such as `3000.m-example.concors.app`; HTTPS upstreams use an
`https-<port>` label. The short-lived machine token travels in the URL fragment,
is immediately removed by the gateway, and becomes an exact-host, HttpOnly,
SameSite cookie. It is never forwarded to the development server. The gateway
proxies normal HTTP and WebSocket/HMR traffic to loopback. Per-machine wildcard DNS
and the existing wildcard certificate keep those routes private to authorized
Concors users without publishing every server port directly.

The collapsed rail retains square preview buttons and rail-only tooltips. Mobile
uses the same automatic inventory and its existing external-link confirmation flow.

## On-demand process monitoring

Open Resources from the computer menu, CPU/RAM indicator, or workspace search.
Desktop uses a centered page; mobile uses the same view in a drawer. Resources and
automatic Previews share one connection-scoped process snapshot and polling loop.

Linux daemons inspect processes visible to their OS user. The full Resources list
intentionally includes infrastructure and agents when diagnosing machine usage.
Rows show CPU, resident RAM, state, and listening ports. Expand a row for its PID,
working directory, protection reason, and explicit Stop action. Filter by name,
PID, or folder and sort by RAM, CPU, or name. Workspace association is based on
working directories, not authoritative workload ownership.

A process row exposes Preview only after the daemon confirms browser content. It
opens the same automatically routed address as the sidebar; it never opens an editor.

Process inspection polls every three seconds while either the application sidebar
or Resources is mounted. The daemon coalesces readings for two seconds. Disconnects
and failures clear stale readings. Machine switches discard pending confirmations.
First-sample CPU is unknown rather than zero. Raw command arguments and environment
variables are not sent to clients.

CPU is a share of the whole machine. RAM is RSS and may double-count shared pages;
other-user processes, containers, kernel memory, and filesystem cache may not be
fully attributable. Process totals need not equal the existing machine indicator.

Stop requires confirmation, rechecks PID/start-time/OS-user identity, protects
daemon/connection infrastructure, and sends SIGTERM to one PID only. Children may
remain and a process may ignore SIGTERM. There is no force-kill, automatic stop,
or idle-timeout policy. Revalidation is not a pidfd-based atomic signal guarantee.
Sleeping or low CPU usage does not establish that a process is unwanted.

## Cleanup is deferred

Storage & cleanup, Scan storage, directory candidate lists, and file-deletion
operations have been removed from this increment, including the daemon/protocol
API. No automatic cleanup runs. Agent-led cleanup, with manual execution or an
explicitly configured schedule, is a separate proposed initiative—not a feature
or daily job installed by this PR. See [the initiative](resource-management-initiative.md).

## Compatibility and validation

The additive machine-resources capability gates inspection, discovery, and stopping.
Older resource-capable daemons omit preview metadata and therefore show no automatic
previews; older daemons receive no unsupported calls. The pre-existing whole-machine
usage indicator is unchanged.

Protocol tests reject the withdrawn storage and cleanup requests. Unit/integration
tests cover process parsing, PID protection, transport compatibility, polling, and
HTTP preview probing and authenticated gateway routing. Browser tests verify automatic
preview navigation, computer-menu navigation, safe stopping, and mobile behavior.
Tests intercept mutations or use isolated fixtures; they do not stop user processes
or remove real machine data. Isolated execution and ephemeral VMs remain parked for V2.
