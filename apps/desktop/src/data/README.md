# Client resource caching

Control-plane views use a session-only `ResourceCache`. Reopening a view reads its last successful response synchronously. Reads share in-flight work and revalidate after 30 seconds (15 seconds for machine lists, five minutes for the machine catalog). Manual refresh bypasses freshness. A temporary refresh failure keeps existing data with an error; a 401/403 removes it.

Keys include request parameters and organization IDs. GitHub repository keys also include the connection revision, installation, and page. Changing the session token or signing out discards the cache. Credentials, sign-in challenges, and responses are never persisted by this cache.

Successful machine and SSH-key mutations update their shared resources and supersede earlier reads. Machine changes invalidate subscriptions. Returning from an external GitHub or card-setup flow explicitly rechecks the relevant data. GitHub disconnect also removes cached repositories.

Daemon-owned state keeps its existing lifetime: workspace replicas and terminal streams belong to the connection; file documents preserve drafts, directory listings are scoped to machine/epoch/project/path, and model discovery has its own revision-aware cache. Agent account prompts still confirm authentication with the daemon before displaying a sign-in request. Host usage distinguishes its initial wait from an unavailable report.
