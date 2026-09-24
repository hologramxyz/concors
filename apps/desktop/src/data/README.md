# Client resource caching

Control-plane views use a session-only `ResourceCache`. Reopening a view reads its last successful response synchronously. Reads share in-flight work and revalidate after 30 seconds (15 seconds for machine lists, five minutes for the machine catalog). Manual refresh bypasses freshness. A temporary refresh failure keeps existing data with an error; a 401/403 removes it.

Keys include request parameters and organization IDs. GitHub repository keys also include the connection revision, installation, and page. Changing the session token or signing out discards the cache. Credentials, sign-in challenges, and responses are never persisted by this cache.

Successful machine and SSH-key mutations update their shared resources and supersede earlier reads. Machine changes invalidate subscriptions. Returning from an external GitHub or card-setup flow explicitly rechecks the relevant data. GitHub disconnect also removes cached repositories.

Snapshots carry `fetchedAt`. Time-sensitive fields are judged against it, never against the current time: a machine's heartbeat in a list read two minutes ago says it was online then, not that it is offline now. The machine switcher also treats any machine with a live connection as online, and re-reads the list before sending someone to Machines.

Machine connections are pooled (`daemon/connection-pool.ts`). Everything asking for the same machine shares one connection, and a machine left behind stays connected for 10 minutes (at most four idle), so switching back reuses its live workspace and every per-connection cache below. Idle connections of another account or organization are closed immediately.

Daemon-owned state keeps its existing lifetime: workspace replicas and terminal streams belong to the connection; file documents preserve drafts, directory listings are scoped to machine/epoch/project/path, and model discovery has its own revision-aware cache. The last 24 opened conversations per connection keep their history window and catch up on reopening; the Providers page shows its last list while it re-checks. Agent account prompts still confirm authentication with the daemon before displaying a sign-in request. Host usage distinguishes its initial wait from an unavailable report.
