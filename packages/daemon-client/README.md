# @concors/daemon-client

Platform-agnostic client for talking to a Concors daemon. Depends only on `@concors/protocol` and the
standard WHATWG `WebSocket`, so the same code runs in the Tauri desktop app, a browser, React Native,
and Node.

```ts
import {
  DaemonConnection,
  describeDaemonEndpoint,
  localDaemonEndpoint,
} from "@concors/daemon-client";

const client = { kind: "desktop", name: "concors-desktop", version: "0.1.0" } as const;

// Bundled daemon on this machine …
const local = new DaemonConnection({ endpoint: localDaemonEndpoint(), client });

// … or the user's VPS. Same class, same protocol.
const remote = new DaemonConnection({
  endpoint: describeDaemonEndpoint("wss://remote-daemon.example", "My VPS"),
  client,
});

const info = await local.connect(); // → { protocolVersion: "v1", daemonVersion: "0.1.0", status: "ready" }
local.subscribe((state) => console.log(state.status));
local.disconnect();
```

## Design notes

- `DaemonEndpoint.kind` (`local` | `remote`) is inferred from the host and exists for UX and, later,
  authentication. It never changes the wire protocol.
- `DaemonConnection` is single-shot by design. Reconnection/backoff policy lives in the host app
  (see `useDaemonConnection` in `apps/desktop`), because the right policy differs between a bundled
  daemon the app itself manages and a remote daemon over a flaky network.
- Anything Node-specific (e.g. spawning the daemon process) is **out of scope** here; that belongs to
  the host integration layer (`apps/desktop/src/tauri`).
