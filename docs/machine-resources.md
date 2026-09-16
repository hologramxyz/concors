# Previews and Resources

The sidebar's Previews section contains named, explicitly supplied HTTP(S) links.
It is not a process inventory: agents, daemons, background workers, RAM/CPU values,
and arbitrary listening ports never appear there automatically. Clicking a preview
opens its URL. The collapsed rail uses square link buttons and rail-only tooltips.

Use the plus beside Previews to add a name and an existing preview/tunnel URL.
Right-click a preview (long-press on mobile) to edit or remove the link. Removing
a preview removes only its link; it never stops a process or deletes files. URLs
with embedded credentials or non-HTTP schemes are rejected. Mobile requires HTTPS
and uses the host's existing external-link confirmation flow.

Links are scoped to the selected daemon connection and currently session-local:
reloading the client clears them. No tunnels are created, ports published, or
remote localhost addresses guessed. A saved URL is not a health check. Durable
cross-device preview registration and automatic URL discovery are future work.

## On-demand process monitoring

Open Resources from the computer menu, CPU/RAM indicator, or workspace search.
Desktop uses a centered page; mobile uses the same view in a drawer. The sidebar
does not request or poll process inventories.

Linux daemons inspect processes visible to their OS user. The full Resources list
intentionally includes infrastructure and agents when diagnosing machine usage.
Rows show CPU, resident RAM, state, and listening ports. Expand a row for its PID,
working directory, protection reason, and explicit Stop action. Filter by name,
PID, or folder and sort by RAM, CPU, or name. Workspace association is based on
working directories, not authoritative workload ownership.

A process port button can attach a named preview URL to Previews. A listening port
alone is not evidence of an HTTP application; databases and daemon ports are not
automatically promoted to previews.

Process inspection polls every three seconds only while Resources is mounted.
The daemon coalesces readings for two seconds. Closing Resources unsubscribes;
disconnects and failures clear stale readings. Machine switches discard pending
confirmations. First-sample CPU is unknown rather than zero. Raw command arguments
and environment variables are not sent to clients.

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

The additive machine-resources capability gates process inspection and stopping.
Older daemons receive no unsupported calls; unsupported platforms explain their
limits. Named preview links do not require the resource-inspection capability.
The pre-existing whole-machine usage indicator is unchanged.

Protocol tests reject the withdrawn storage and cleanup requests. Unit/integration
tests cover process parsing, PID protection, transport compatibility, polling, and
preview URL validation. Browser tests verify previews never become a process list,
computer-menu navigation, safe stopping, mobile behavior, and preview editing.
Tests intercept mutations or use isolated fixtures; they do not stop user processes
or remove real machine data. Isolated execution and ephemeral VMs remain parked for V2.
