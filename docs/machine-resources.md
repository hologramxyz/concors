# Processes and Resources

The sidebar's Processes section replaces the Servers placeholder. It shows up to
six discovered processes, prioritizing listening ports and then resident RAM.
Protected daemon/connection infrastructure stays in the full list, not the sidebar.
Collapsed rows remain square, with tooltips only in the collapsed rail.

With multiple processes, a subtle View all link below the sidebar list opens
Resources. The section heading has no management control. With zero or one process,
use workspace search or the CPU/RAM status bar. Desktop uses a centered Resources page. Mobile
opens the same view in a drawer from the usage row or Processes section.
All actions target the selected machine;
switching connections discards confirmations, storage scans, and preview mappings.

## Running

Linux daemons inspect processes visible to their OS user, including work launched
outside Concors. The view includes executable/script labels, PID, working folder,
state, resident RAM, whole-machine-normalized CPU, and TCP listening ports. Filter
by name, PID, or folder and sort by RAM, CPU, or name. Known workspace association
is based on the process working directory; it is not authoritative launch ownership.

The full list uses compact, borderless rows like the sidebar, with usage and preview
links visible. Expand a row for its PID, working folder, protection reason, and Stop
or Change preview link actions. Stopping processes and deleting files still require
confirmation.

One serialized daemon sample is reused for two seconds across clients. Each client
shares a three-second polling loop across the sidebar and page. Mobile polls only
while the sidebar or Resources view is mounted/visible. Polling stops after the last
observer, and disconnected/failed readings are cleared. The first CPU sample is
unknown, not zero. Raw command arguments and environment variables are not sent to
clients. `ss -H -ltnp` supplies ports when available; failure does not hide processes.

Sleeping means waiting, not unwanted. Stop always requires confirmation, checks the
PID/start-time/OS-user identity again immediately before SIGTERM, and protects the
daemon, its ancestors, and recognized connection infrastructure. It signals only
the selected PID, never a process group; children may remain and a process can ignore
SIGTERM. No force kill, idle timeout, or automatic stop is implemented. Identity
checks reduce stale-PID risk but are not a pidfd-based atomic signal guarantee.

RAM is RSS, which can double-count shared pages. CPU is a percentage of the whole
machine, not of one core. Other-user, container, kernel, filesystem cache, and
memory-backed file usage are not fully attributable to this list. Its totals are
not expected to sum to the machine status indicator. Docker workload grouping,
durable ownership, pinning, and process-tree lifecycle management remain future work.

## Preview links

A listening port is not necessarily an HTTP server or a publicly reachable URL.
Use its port button to attach an existing HTTP(S) preview/tunnel URL. That mapping
is shared with the sidebar for the current connection, so subsequent clicks open
the preview directly. Links reject non-HTTP schemes and embedded credentials.

Mappings are session-local and process-identity-specific. This increment does not
create tunnels, publish ports, guess a remote localhost URL, or claim every TCP
listener is previewable. Desktop uses the external browser opener. Mobile routes
links through its host's existing confirmation flow and requires HTTPS; the form
enforces that restriction.

## Storage and cleanup

Storage scans run only when requested. They inspect:

- Git worktrees registered with repositories in open workspaces, including linked
  worktrees outside those workspace folders.
- Same-user entries immediately under the OS temporary directory and `/var/tmp`.
- Same-user cache directories immediately under `~/.cache`.

The scan shows paths, branch names where known, allocated file blocks, filesystem
capacity, RAM-backed/tmpfs status, and why cleanup is blocked. Shared/hard-linked
files may be counted more than once; displayed sizes are not guaranteed reclaimable
bytes. There is no blanket scan or cleanup of the whole home directory, Docker
volumes, container images, or arbitrary disk paths. Scan work is bounded (128
entries, per-tree entry/time limits and an overall inspection time budget); unknown
sizes and incomplete checks are shown rather than assumed safe.

Cleanup requires the exact full path typed into a confirmation. The request uses a
daemon-issued candidate ID, not an arbitrary client-supplied deletion path. Before
acting it rechecks ownership, path resolution, metadata fingerprint, same-user
process working directories/open files, and local Docker-compatible bind mounts
(default, rootless, and explicitly configured Unix sockets). If
Docker inspection or process inspection is uncertain, cleanup is refused. It does
not detect every possible external writer or container runtime; this is explicit
manual cleanup, not a sandbox or an automatic disposability guarantee.

Open workspace paths, primary checkouts, locked worktrees, nested Git checkouts in
temporary entries, other-user files, mounted filesystems, sockets, and changed
entries are protected. A linked worktree must have no modified, untracked, or
ignored files and no commits absent from fetched remote refs. `git worktree remove`
is used without force; branches are retained. Remote refs are not fetched by a scan.

Temporary/cache entries are renamed to a unique sibling, verified again, and then
removed. If removal fails, the error identifies the remaining path. Deletion is
permanent, not a trash operation; history and recovery are not implemented. Freeing
disk storage does not necessarily release RAM, and stopping a process is separate
from deleting its files. No cleanup runs simply because an entry is old.

## Compatibility and validation

The additive `machine-resources` capability gates `resource.request` / `resource.result`.
Requests require the existing handshake and workspace subscription. Older daemons
receive no unsupported calls. Non-Linux daemons explain the platform limitation;
the pre-existing whole-machine CPU/RAM indicator is unchanged. The mobile protocol
relay forwards the same operations and confirmations, with no second cleanup path.

Unit/integration tests cover schemas, parsing, PID protection, changed files,
worktree guards, symlinks, container-use guards, transport compatibility, shared
polling and preview URL validation. Browser tests use intercepted resource actions;
the mobile demo simulates process and cleanup operations without touching real
machine resources. Tests never terminate arbitrary processes or clean live files.

See the [initiative](resource-management-initiative.md) for future ownership and
automation work. Agent-driven isolated execution and temporary VMs are parked for
V2 and are not provisioned or implemented here.
