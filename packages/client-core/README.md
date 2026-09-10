# @concors/client-core

Host-independent behavior, without React, native, Tauri or daemon implementation dependencies.

- `ConnectionController`: selected-machine lifecycle, guarded async connections, first-snapshot
  readiness, retry/deadlines, stale read-only state, fresh token on resume, bounded authorization refresh.
- `HydratedTokenStore`: asynchronous secure-storage hydration behind the synchronous API
  token interface; ordered writes and explicit `flush` errors.
- `mergeItems`: shared desktop/mobile transcript merge by ID, revision and position.
- Notification payload validation, account checks, bounded deduplication and internal routes.
  Navigation validation is not authorization; clients re-fetch server state.

Mobile supplies AppState/network availability and Expo's UUID factory. Run
`pnpm --filter @concors/client-core test` and `typecheck` from the root.

- `hosts`: C1/C2 host schemas, authoritative connection URLs and 90-second availability.
- `createManagedConnection`: account/machine validation and bearer-subprotocol transport.
- `MachineCredentialStore`: serialized native credential writes with cancellation leases.
