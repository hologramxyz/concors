# Concors MVP — proposed development plan

Draft for review, 2026-09-07. No product implementation is authorized by this document. Recommendations below remain open to review.

## 1. Product contract

Concors is a cross-platform client for managing development machines. A machine can be this computer, a self-managed remote machine, or a Concors Cloud machine. The same workspace experience works in free local mode without a cloud account.

Desktop targets: macOS, Linux, Windows. Mobile MVP targets: iPhone/iOS and Android, with a shared React Native/Expo application intended for publication on the Apple App Store and Google Play. Android is part of the MVP, not a future extension.

Each selected machine has three first-class sidebar sections:

- **Projects:** local folders, newly created projects, and repositories cloned from GitHub.
- **Agents:** all active agents across that machine's projects, with project context and working, needs-input, done, or failed status.
- **Servers:** discovered development servers with reachable preview links and project association where known.

The machine switcher sits at the top of the sidebar. It lists local, connected remote, and cloud machines; shows connection/provisioning state; and offers Add machine. That flow separates connecting an existing machine from provisioning a new cloud machine.

Selecting a project opens its saved tab collection. Tabs are organizational containers, not tasks or worktrees. Each tab contains a tree of split panes. Initial pane choices:

1. Shell terminal.
2. Unified agent chat, with provider selection.
3. Agent terminal profile: Codex, Claude Code, or OpenCode.

A terminal profile starts the real provider CLI in the project's working directory. Unified chat presents structured provider events in a consistent conversation interface. These are two presentations/integration paths; the UI must explain if a session cannot switch between them.

## 2. Starting point

The `concors` repo already has a React/Tauri desktop shell, Node/TypeScript daemon, protocol package, and host-independent WebSocket client. The current protocol only performs a handshake. There is no durable project/session model or working terminal/agent runtime yet. `apps/mobile` is a placeholder intended for React Native/Expo.

The `concors-server` repo has authentication and organization support. Machine and project routes are placeholders; provisioning, daemon authorization, preview routing, and push delivery still need implementation. `concors-web` is currently empty and is not required for the first local development milestone.

Retain these boundaries rather than rebuild the foundation.

### Reference implementations to follow

Use [Paseo](https://github.com/getpaseo/paseo) and [Herdr](https://github.com/herdrdev/herdr) as implementation references, not just visual inspiration. Review their relevant source and tests before implementing each corresponding feature, record the reference revision, and adapt their established behavior to Concors' protocol and synchronized workspace model.

| MVP feature | Reference and intended behavior |
| --- | --- |
| Unified chat UI | Follow Paseo's provider adapters and shared timeline: streamed messages, tool summaries with expandable details, permission/input requests, queued prompts, cancellation, turn timing, and history/reconnect continuity. |
| Agent profiles | Follow Paseo's provider configuration approach: named reusable profiles selecting provider, model, supported mode/permission options, and launch configuration. Expose provider capabilities accurately. Store portable profile configuration on the machine for synchronized use; keep credentials on the machine and out of client state. |
| Terminals and terminal profiles | Review Paseo's terminal/session implementation and Herdr's persistent terminal attachment behavior. Provide a normal shell plus one-click Codex, Claude Code, and OpenCode profiles, using the project's directory and stable session bindings. Distinguish a launch profile from a running session. |
| Agent status and progress tracking | Follow Paseo's structured turn lifecycle and Herdr's agent detection/attention model. Track working, needs input, done/unseen, idle/seen, failed, and unknown where necessary; show current action and elapsed time when available. Keep status consistent across chat, terminal-backed agents, and the global agent list. |
| Spaces/project layout and agent navigation | Follow Herdr's spaces, tabs, split panes, agent overview, and attention rollups. In Concors, Projects occupy this organizational role, with tabs independent of tasks/worktrees and layouts synchronized across clients. |
| Completion and input notifications | Follow Herdr's distinct completion/input sounds, attention indicators, and focus-aware notification handling; use authoritative events and deduplication across reconnects. Add Concors desktop notifications and iOS and Android push integration. |

Source entry points are recorded in [reference-notes.md](reference-notes.md). Validate feature behavior against reference scenarios and tests, including completion followed immediately by another turn, pending approvals, reconnect during streaming, and multiple clients viewing one session. If reusing source or assets, preserve the applicable license and attribution requirements. Adapt implementation details to React/Tauri, React Native, and the existing daemon boundary; do not assume upstream components can be dropped in unchanged.

### Pierre owns the cloud server repository

Pierre is actively working on `concors-server`. Treat that repository as read-only for our implementation work: no source/configuration edits, commits, migrations, or server deployments. Our implementation scope is the client and machine daemon/shared packages in `concors`, plus review notes here.

At the start of implementation sessions and before cloud integration work, check the server checkout's working tree and pull the latest upstream changes with `git pull --ff-only` when the tree is clean and the update can fast-forward. Read Pierre's current routes, schemas, and documentation before designing client calls. Preserve any local edits; do not reset, stash, resolve divergent history, or overwrite his work automatically. If a pull is blocked, report it and continue independent client work.

The server inventory above describes the initial review, not a permanent assumption about missing functionality. Refresh that assessment after pulls. Document required API contracts and gaps for review with Pierre; integrate the APIs he supplies rather than implementing parallel server endpoints. Sending him messages requires separate authorization.

## 3. Architecture and ownership

| Component | Owns |
| --- | --- |
| Machine daemon | Projects, ordered tabs, pane trees, session bindings, terminal/agent processes, conversation history, server discovery, durable workspace state |
| Desktop client | Rendering, keyboard/mouse interactions, native notifications, local daemon installation/lifecycle integration |
| iOS/Android client | Mobile presentation of the same state, remote interaction, push registration and notification navigation |
| Shared client packages | Protocol, command transport, state replica, reconnect logic, provider-independent presentation/domain helpers |
| Concors Cloud control plane | Accounts/organizations, machine inventory/provisioning, access grants, connectivity coordination, preview routing, push delivery |

**Recommendation: the machine daemon is authoritative for that machine's workspace.** Both local and cloud machines use the same implementation. Cloud does not keep a competing writable layout database. This makes local-only mode a complete mode of operation, and makes all clients of a machine converge on the same state.

Use a transactional on-machine store, provisionally SQLite, for workspace records, session metadata, message history, command deduplication, and durable notification events. Validate packaging on all three desktop OSes before committing to the driver. Keep high-volume terminal output in a separately bounded replay buffer/log rather than storing every byte as a workspace mutation.

Cloud caches may expose machine metadata/status while a daemon is offline. Last-known workspace state is visibly stale and read-only until reconnection. Cloud backup/restore of machine data can follow the MVP; losing a VM disk must not be described as recoverable without a backup feature.

## 4. Shared state and synchronization

Suggested domain records:

| Record | Key fields / responsibilities |
| --- | --- |
| Machine | Stable ID, display name, local/self-managed/cloud kind, connection/provisioning state |
| Project | Machine ID, name, canonical directory, optional repository origin, ordering |
| Tab | Project ID, title, ordering, root pane-layout node |
| Layout node | Split axis, normalized ratio, child IDs; or a leaf pane ID |
| Pane | Presentation kind, stable session binding; independent of process lifetime |
| Session | Project ID, runtime/provider type, process or provider-session identity, lifecycle |
| Agent profile | Machine ID, name, provider, optional model/mode, validated provider options, launch configuration; no credential payloads |
| Agent | Session ID, project ID, display name, provider, activity, attention reason, current turn |
| Dev server | Machine/project association, port/protocol, observed process identity, reachability, preview route |
| View preference | User ID and machine/project scope, shared selected project/tab; device-specific overrides where explicitly allowed |
| Notification event | Stable event ID, agent/turn ID, completion or input/error reason, creation time |

Use stable IDs rather than array positions or process IDs as identity. A project is a directory, not necessarily a Git repo. Worktree automation is outside the initial MVP; existing worktree folders can still be opened as projects.

Synchronization flow:

1. Client authenticates, negotiates protocol capabilities, and receives a snapshot with a revision/cursor.
2. User actions send explicit commands: create project, open tab, split pane, bind session, reorder tab, select tab, resize split, etc.
3. Each command has a unique ID and appropriate entity version preconditions. The daemon serializes mutations, validates references, commits state and event together, then acknowledges and broadcasts.
4. Clients apply the same ordered events. Retried commands return the original result without repeating process launches or creating duplicate panes.
5. Reconnection requests events after the saved cursor. If history is unavailable or the store epoch changed, replace the replica with a fresh snapshot.
6. Conflicting edits to the same layout are rejected with fresh state for retry; unrelated edits should not conflict simply because a machine-wide revision advanced. Deleting a pane wins over stale resize/input commands targeting it.

Only preview split resizing locally while dragging; commit the final ratio or throttled changes. Do not broadcast every mouse movement. Session input and output use separate streams and backpressure from layout commands.

**Shared by default:** projects, tab order/titles, pane topology and ratios, session bindings, and selected project/tab, as requested. Scope selection per user rather than forcing different organization members to navigate together. Switching machines itself remains device-local so a phone and laptop can inspect different machines.

**Keep device-local:** window size, keyboard state, hover, text selection, unsent drafts, notification permission, and mobile pane focus. Persist scroll locally in MVP; later offer shared chat message anchors, not raw pixel offsets. Phone and desktop viewport sizes make pixel synchronization unreliable.

On iPhone and Android, preserve the canonical split tree but display a navigable single pane or compact pane list. Merely viewing on a phone never collapses the saved desktop layout. Explicit mobile layout edits do update the shared tree.

Disconnected clients can read cached state. Structural edits and process commands require a live daemon in MVP, avoiding a second offline conflict-resolution system.

## 5. Runtime and session behavior

The daemon owns terminals and agents independently of open client windows. Detaching a client does not stop work. Closing a pane detaches that view; stopping a session is a separate explicit action. Active detached agents remain reachable through the global Agents list. Define bounded retention and cleanup for inactive sessions.

Terminal implementation must support PTYs, stdin, resize, output sequencing, reconnect replay, and bounded buffering on macOS/Linux/Windows. When two devices view one terminal, use explicit input/resize ownership: latest intentional takeover controls terminal dimensions; passive viewers must not repeatedly resize it. Background tabs must not steal ownership.

Daemon restart restores metadata/layout and marks interrupted runtimes accurately. It does not magically preserve OS processes. Provider sessions may be resumed when the provider supports it; interrupted shells are clearly marked for restart. Closing a laptop lid or losing power can suspend or stop local execution; a cloud VM continues only while that VM is running.

For unified chat, provider adapters normalize messages, streamed output, tool starts/results, input/permission requests, cancellation, completion, and errors. Expose capabilities for unsupported features instead of simulating them. Implement one adapter end-to-end first, then validate the contract against the other two before declaring the MVP complete.

For agent terminal profiles, use supported lifecycle signals where available and explicit detection fallbacks where necessary. Report unknown state when evidence is insufficient. Avoid interpreting silence as success.

Separate execution state from attention: an idle agent with an unseen successful turn is displayed as Done; a permission request is Needs input; a provider error is Failed; transport disconnection is a separate connection indicator. Show elapsed turn time and current action when available. Do not invent percentage completion.

## 6. Projects and dev-server previews

Projects support opening an existing directory, creating a directory, and cloning GitHub HTTPS/SSH repository URLs. Use machine-side credentials without copying them into clients. Repository browsing through a GitHub integration can follow URL-based cloning. Clone operations report progress, cancellation, and failure before creating a usable project entry.

Discover listening ports on the machine and use process/cwd ancestry to associate them with projects where possible. Supplement with development-tool output hints. Unknown associations remain visible. A listening port is not automatically an HTTP server: distinguish candidate listeners from confirmed/configured preview services and track startup, ready, stopped, and unreachable states.

Preview route behavior:

- On the same physical machine, open an appropriate loopback URL.
- On another device, open a reachable authenticated forwarded/proxied URL. Never send the phone to its own localhost for a VM server.
- Cloud preview routing must support WebSockets/HMR as well as HTTP, browser authentication, route cleanup, and machine authorization.
- Automatically detect services, but do not automatically publish every listening port to the internet. Public sharing is an explicit later action unless we choose it for MVP.

Provider for cloud VMs and tunnels remains an open decision. Start with a connectivity interface and a working self-managed connection; integrate the selected cloud provider before the cloud milestone is accepted.

## 7. Notifications

Create semantic events on authoritative agent transitions: finished, needs input, failed. Deduplicate by stable event and turn IDs; revalidate delayed input/completion notifications so resumed work does not generate a stale alert.

Desktop: distinct completion/input sounds, native notifications, user opt-in, and click-through to the machine/project/agent. Suppress redundant completion alerts for the conversation currently being viewed. Keep preferences per device and allow sound to be disabled separately.

iOS and Android: push registration, authenticated device-token ownership, delivery through a cross-platform push service or APNs/FCM adapters, and deep links that re-fetch current state. Delivery is best-effort; unread attention in the app remains authoritative. Do not depend on persistent mobile background WebSockets for push delivery. Isolate platform-specific permission, token refresh, and notification behavior behind shared interfaces.

Free local mode works without cloud for workspaces, terminals, agents, and foreground notifications. Mobile background pushes need a configured notification service; direct local connectivity alone cannot promise that feature. A local computer must be awake and reachable for remote control.

## 8. Delivery sequence and review gates

| Phase | Deliverable | Acceptance gate |
| --- | --- | --- |
| 0 — Contract and UX | Agree on this plan, state ownership, navigation rules, desktop/mobile wireframes, command/event schema | Walk through one project with two tabs and split panes on laptop and phone; agree on close vs stop semantics |
| 1 — Durable synchronized workspace | Machine connection abstraction, persisted projects/tabs/layouts/bindings, snapshot/events, replica/reconnect logic, functioning sidebar | Two clients converge after create/split/reorder/delete; reconnect and daemon restart retain structure; command retries do not duplicate records |
| 2 — Local working environment | Local project creation/open/clone, real PTYs, shell and provider terminal profiles informed by Paseo/Herdr, terminal replay and ownership | Run commands in split panes; launch Codex/Claude Code/OpenCode profiles; disconnect/reconnect without duplicate shells; test shell/resize behavior on all desktop OSes |
| 3 — Unified chat and agent overview | Paseo-style unified chat and reusable agent profiles; first structured provider adapter, then remaining providers; Herdr-style agent tracking/attention and desktop sounds/notifications | Real turns stream tools/text, request input, queue prompts, cancel, finish, fail, and resume where supported; profile selections persist; sidebar and chat agree |
| 4 — Mobile client | Expo/React Native app, shared replica, machine switcher, project/tab/pane navigation, chat and terminal interaction | Desktop, iPhone, and Android control the same sessions and layout; phone navigation does not destroy split structure; app resume resynchronizes |
| 5 — Cloud and servers | Client/daemon integration with Pierre's server APIs for authenticated remote access, machine inventory/create/connect, private previews, and iOS/Android pushes; daemon-side server discovery | Against Pierre's available backend: provision a machine, clone a repo, run an agent and dev server, open preview from desktop/iPhone/Android, receive background notification and return to agent; missing server contracts remain explicit dependencies |
| 6 — MVP release | Installable desktop packages, signed iOS/Android builds, TestFlight/Google Play testing, store submission packages, local service lifecycle, migrations, failure recovery, onboarding | Clean local install works without login; full cloud scenario passes on iOS and Android; platform and multi-client regression suite passes; both mobile apps are ready for store submission |

Mobile and cloud contracts are designed in phase 0 and exercised with representative clients in phase 1. Their full UI/infrastructure arrives later; they must not require replacing the workspace model.

Phase 5 does not authorize changes to `concors-server`. Pierre supplies the control-plane implementation. Client-side contract fixtures may unblock development, but tests against fixtures do not count as completed cloud integration.

### Cross-platform mobile and store publication

Build one mobile app in `concors/apps/mobile` using React Native/Expo, sharing screens, navigation, state synchronization, and chat behavior across iOS and Android. Share protocol and client-state packages with desktop. Keep native notification, secure credential storage, deep-link handling, and terminal rendering bridges behind platform interfaces; validate terminal input/rendering on both platforms early.

Store readiness is part of the MVP delivery scope:

- Produce signed production iOS and Android builds with stable application identifiers, versioning, and repeatable build configuration.
- Establish Apple and Google developer-account access and signing credentials when release work begins; keep credentials outside the repository.
- Distribute test builds through TestFlight and Google Play testing, and validate real-device installation, upgrades, login/local connection, push, and deep links.
- Prepare store listings, screenshots for each platform, support/privacy links, permission explanations, and applicable privacy/data disclosures. Review current store requirements during implementation and again before submission, including account deletion and billing rules where the final product requires them.
- Verify that the remote terminal/agent interaction and any cloud subscription purchase flow fit current store requirements before finalizing those flows. Expo is the implementation choice, not a guarantee of store approval.
- Deliver submission-ready packages for both stores. Uploading, submitting for review, or publishing requires explicit authorization at that stage; this plan does not authorize publication. Store approval remains an external dependency.

## 9. Validation and release requirements

- Protocol/store tests: command idempotency, reference validation, concurrent layout changes, atomic persistence, migrations, replay gaps, stale snapshots, and crash recovery.
- Two-client integration tests: tab/pane/session synchronization, switching projects, disconnected/reconnected clients, delete-vs-edit conflicts, and no duplicated process launches.
- Runtime tests: real PTY interaction, Unicode/ANSI behavior, bounded output, terminal ownership, process exit, provider errors, cancellation, and permissions.
- Notification tests: no replay duplicates, no stale finished notification after a new turn, click-through navigation, device preference handling, and physical iPhone and Android background delivery.
- Preview tests: correct remote address, WebSocket/HMR, authorization, stale-port cleanup, and no public route without intended exposure.
- Platform checks: macOS/Linux/Windows terminal and native notification behavior; iOS and Android keyboard, app background/resume, touch navigation, and push flows. Record actual coverage rather than claiming support from shared source alone.
- Remote execution access: authenticate daemon connections, validate browser origins, bind project access to machine grants, revoke credentials, and authorize preview/push routes. Local loopback endpoints also need protection from unrelated web origins.

## 10. Decisions for review

1. Confirm Agents is global across projects **within the selected machine**. A cross-machine inbox could be added later.
2. Confirm shared active project/tab per user, with mobile pane focus and scroll remaining device-local.
3. Use React/Tauri for desktop and one React Native/Expo app for iOS and Android. Review the small platform-specific integrations while sharing mobile UI, protocol, and state logic.
4. Choose the first unified-chat provider; proposed order is Codex, Claude Code, OpenCode, with all three required before the complete MVP is declared.
5. Choose cloud VM provisioning and private preview connectivity providers, or identify any existing implementation/configuration outside these repos.
6. Decide whether local-only users should be offered an optional hosted push relay. Both iOS and Android are confirmed mobile MVP targets.

Suggested first implementation scope after approval: phase 1, demonstrated in two browser windows using the existing desktop web runner, followed immediately by a real terminal in phase 2. This proves the central synchronization requirement before expanding the runtime and platform surface.
