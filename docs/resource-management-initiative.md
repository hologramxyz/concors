# Resource visibility and safe cleanup

Status: product initiative captured and revised on 2026-09-16. The current increment is
implemented in [Previews and Resources](machine-resources.md). The directory-by-directory
cleanup UI was tried and withdrawn. Agent-led cleanup, run manually or on an explicitly
configured schedule, is a separate future initiative; no daily job is installed. The broader
ownership, automation, and isolated-execution directions below remain proposals,
not delivery commitments. Whole-machine reporting is documented in
[Machine CPU and RAM](host-resource-usage.md).

## Why this matters

Concors should feel like one coherent computer: projects, agents, terminals,
services, files, and previews remain connected across activities. A persistent
machine offers continuity and a predictable baseline cost, but users should not
have to become system administrators to keep it usable.

Whole-machine CPU/RAM totals answer how full the machine is, not what is consuming
resources, who started it, or what can safely be stopped. Preview links identify
some servers but miss test runners, browser workers, background jobs, worktrees,
and temporary files. These are the starting problems for this initiative.

## Proposed experience

Keep Previews in the sidebar: named links to things the user can open. Do not put
an operating-system process analyzer beside the workspaces or duplicate the Agents
list. Open Resources from the computer menu or CPU/RAM indicator when inspection
is needed. The following richer workload ideas belong in Resources, not the sidebar:

- Group related child processes, such as a browser test runner and its workers.
- Attribute workloads to their project, checkout, and initiating agent or terminal
  where known. Show unknown ownership honestly.
- Show CPU/RAM, status, and actions to inspect logs, jump to the originating pane,
  open a preview, or stop a workload. Keep agent conversations in the Agents UI;
  avoid making users navigate duplicate lists of the same agents.
- Let users pin a service they expect to keep running.
- Keep process inspection on demand. The current Resources page shows running
  processes, with no Storage or Cleanup tabs.
- Provide the same information and safe actions on mobile with a compact layout.

An agent is better placed to investigate worktrees, temporary directories, logs,
caches, and artifacts than a user reviewing a large directory list. Explore a
manual or scheduled cleanup task with a dry-run plan, ownership checks, explicit
authority, and a clear report of changes. Do not infer permission for daily deletion.
Separate system/unattributed usage from attributed workloads; do not imply that
summed process memory precisely equals whole-machine usage or double-count shared
memory. Distinguish disk storage from memory-backed filesystems and process memory.

## Ownership before automation

Record ownership when Concors launches work, even before all of the UI exists:

- Durable workload identity, machine, project, checkout, and initiating session.
- Job versus persistent-service lifecycle, explicit pins, and expected completion.
- Process/container membership and a reliable identity beyond a reusable PID.
- Owned ports, preview routes, temporary directories, worktrees, and volumes.
- Resource budgets, retention policy, and whether each resource is disposable.

Persist this information and reconcile it after daemon restarts. Losing a browser
connection or ending an agent turn must not imply that its services can be stopped.
Do not rely only on parent PIDs: children can outlive their original launcher.

Use three lifecycle categories:

1. **Managed temporary work:** bounded tests, builds, workers, and explicitly
   disposable scratch resources. Eligible for automatic reclamation under a known
   policy after completion and ownership checks.
2. **Persistent services:** dev servers, databases, watchers, and tunnels. Keep
   running until an explicit stop or a previously agreed lifecycle rule.
3. **Discovered or unclassified work:** display and investigate; do not silently
   terminate or delete based on a guess.

Low CPU usage is not evidence that a process is unwanted. A quiet database or dev
server may be essential. Conversely, completed jobs should not leave owned worker
processes running indefinitely.

## Safe cleanup rules

Automate cleanup only for resources whose ownership and disposable lifecycle are
known. Use deterministic checks; an agent can propose a cleanup plan, but its
description alone is not evidence that deletion is safe.

- Stop an explicitly selected workload gracefully before considering force. Check
  identity again when acting so a stale UI cannot target a reused PID or resource.
- Reclaim confirmed leftover workers from completed managed jobs, bounded expired
  logs, and designated regenerable artifacts under explicit retention policies.
- Before removing a worktree, check modified, untracked, and valuable ignored files,
  unique/unpushed commits, active process usage, and pins. Preserve anything with
  uncertain value; Git cleanliness alone does not establish disposability.
- Treat old worktrees and idle discovered processes as review candidates, not
  automatic deletion targets solely because of age or inactivity.
- Identify memory-backed worktrees and scratch directories separately. Do not assume
  that every `/tmp` directory is in RAM, or that deleting disk files frees RAM.
- Never use blanket Docker pruning, volume deletion, or broad temporary-directory
  sweeps as the default cleanup policy. Database volumes need explicit retention
  and deletion decisions.
- Show the exact affected resources and expected consequences before destructive
  manual actions. Keep a cleanup history and say honestly which actions are
  recoverable; stopping a process does not preserve its in-memory state.

## Prevent pressure, not only explain it

Longer term, combine visibility with resource-aware admission: leave host/daemon
headroom and queue, limit, or offer remote execution before starting another heavy
workload. Measurements are estimates, not a guarantee that a job cannot spike.

Evaluate OS-supported workload accounting and limits rather than repeatedly
guessing process trees. On Linux, cgroups are a candidate for grouping and budgets;
they do not by themselves provide a security sandbox. Platform capability and
unavailable-data states must be explicit. See the
[Linux cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html).

## Incremental delivery

1. Previews in the sidebar, on-demand Resources monitoring, and safe manual stop.
2. A separate agent-led cleanup experiment: manual runs first, explicit schedule
   and scope if approved, dry-run review, and a record of actions taken.
3. Managed job/service ownership and lifecycles, conservative cleanup policies,
   and reclaim history—not a directory-by-directory cleanup dashboard.
4. Resource-aware scheduling and budgets.
5. Optional on-demand workers and preview environments, using the same ownership
   model rather than introducing a disconnected second computer experience.

Future daemon/client contracts belong in the shared protocol and must support both
desktop and mobile. Provisioning or billing contracts needed from the control plane
must be specified separately; this proposal does not authorize infrastructure work.

## V2 exploration: agent-driven isolated execution

Parked for a separate branch and a later experiment. The main problem is the agent
repeatedly asking the user to coordinate ports, memory, disk space, and competing
work, not a missing preview-creation button. Evaluate an agent-facing capability
for safe independent execution, shared resource ownership, and explicitly approved
burst budgets before deciding whether this needs dedicated UI. Do not provision
extra machines, transfer credentials, or interrupt another agent as part of V1.

## Related exploration: parallel branch previews

A preview environment should own its checkout, services, routing, configuration,
and mutable data. This makes it possible to inspect or stop one branch's stack
without disrupting another. Worktrees alone isolate working files, not runtime
ports, database state, or compute capacity.

Candidate execution modes, not yet selected or implemented:

- Same machine: separate checkout plus a distinct Compose project, isolated mutable
  volumes/networks, and separate host-port routing. Inspect fixed container names,
  external resources, global image tags, host networking, and absolute bind mounts
  before assuming project names provide isolation.
- On-demand VM: separate checkout and stack on another machine, useful for capacity
  or host-level conflicts. Environment preparation, scoped credentials, test data,
  external service isolation, and preview access still need explicit handling.

The persistent machine remains the user's home. On-demand execution is an optional
capability, not a requirement to replace every task with a new machine. A preview
can remain available for a useful period; temporary compute need not mean deleting
its data immediately. Stop, restart, and delete must have distinct consequences.

The first experiment should use a real complex project: keep branch A healthy while
an agent uses its working setup as a reference to prepare branch B independently.
Do not switch A's checkout, share its writable database, or blindly copy credentials.
Validate B's preview and data isolation, recheck A, then stop B and account for all
remaining resources. Save the successful setup as a repeatable recipe. Evaluate
same-machine and remote execution separately; do not promise arbitrary-project
portability before this test.

Technical references:

- [Git worktrees](https://git-scm.com/docs/git-worktree) support simultaneous checkouts.
- [Compose project names](https://docs.docker.com/compose/how-tos/project-name/)
  support separate installations, including feature-branch environments.
- [Compose networking](https://docs.docker.com/compose/how-tos/networking/)
  distinguishes container ports from published host ports.
- [Compose volumes](https://docs.docker.com/reference/compose-file/volumes/)
  document external volumes and custom names that are not project-scoped.

## Success criteria and open questions

Users can identify what consumes resources, understand its owner, and stop a chosen
workload without collateral impact. Temporary managed work leaves no unexplained
workers or storage behind. Pinned services survive UI disconnects. Cleanup preserves
valuable work, and uncertain cases stay reviewable rather than being silently
deleted. Daemon restarts and partial failures must not lose ownership safeguards.

Before implementation, resolve:

- How to classify arbitrary shell-launched work and let users correct attribution.
- How to group Docker containers with their launching workload without double-counting.
- Which retention defaults are safe, and which resources require explicit opt-in.
- How to detect active worktree use beyond a process's current directory.
- Which accounting/control features are available on each supported OS.
- How much environment preparation an agent can reliably infer from a working
  machine, and what needs a saved recipe or user input.
- How to expose remote runtime costs, budgets, data retention, and stop policies
  before provisioning additional capacity.
