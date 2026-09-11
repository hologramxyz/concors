# Machine CPU and RAM

The desktop/web workspace has a compact status bar showing the selected machine, CPU
percentage, and RAM used/total plus its percentage. It remains visible in settings,
when the primary sidebar is collapsed, and while workspace content scrolls.

Readings come from the selected machine's daemon, not the browser or just Concors's
process. Switching machines immediately drops the previous readings. CPU or RAM at
90% or above shows a **High usage** label; this is visibility, not an automatic
workload limiter or a guarantee against running out of memory.

## Measurements and limits

- CPU is the change in busy versus total time across all logical CPUs, normalized to
  0–100%. The first reading is unknown while the baseline is established; unavailable
  counters are never shown as zero. See [Node's OS CPU counters](https://nodejs.org/docs/latest-v24.x/api/os.html#oscpus).
- Linux RAM is total minus `MemAvailable`, so reclaimable cache does not look like
  exhausted memory. Other platforms (or Linux without `/proc/meminfo`) use OS free
  memory. See [the kernel's memory field definitions](https://docs.kernel.org/filesystems/proc.html#meminfo).
- These are whole OS/VM metrics, not per-container, cgroup, service, process, swap,
  or provider billing quotas. Container/service limits may be lower than the shown
  machine totals. No processes are stopped and no machine configuration changes.

## Transport and lifecycle

Daemons advertise `host-usage`; supported clients opt in with `host.subscribe` and
receive `host.usage` over the existing authenticated connection. No extra HTTP
endpoint, external telemetry service, or credentials are introduced. The embedded
mobile protocol relay preserves this capability; the visible bar is desktop/web UI.

One shared sampler runs approximately every two seconds while at least one viewer
is subscribed. Reads do not overlap; unsubscribing, disconnecting the last viewer,
or closing the daemon stops polling. Measurement failures send an unavailable
reading without closing agent or terminal sessions.

The UI hides readings after ten seconds without a new sample and on disconnect.
Freshness uses client receipt time to tolerate different machine clocks. Older
daemons show **Update daemon for usage** and receive no unsupported messages.
Deploy the updated daemon to each machine to enable the indicator there.
