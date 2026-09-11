# Machine resource usage

Managed gateways collect a lightweight RAM and root-filesystem sample with each 30-second heartbeat. The authenticated control plane keeps only the latest sample on the machine and exposes it through the existing organization-scoped machine responses. The Machines page polls every 30 seconds while visible (15 seconds during provisioning/deletion).

## Contract

`POST /api/v1/agent/heartbeat` accepts optional `resources`:

```json
{
  "memory": { "totalBytes": 8589934592, "availableBytes": 3221225472 },
  "disk": { "totalBytes": 42949672960, "availableBytes": 32212254720 }
}
```

Each capacity may be null when collection is unavailable. Values are nonnegative safe integers, total must be positive, and available cannot exceed total. Linux memory uses `MemTotal` and `MemAvailable` from `/proc/meminfo`; reclaimable cache is available memory. Disk uses `statfs('/')`: `blocks * bsize` total and `bavail * bsize` available to ordinary users. Displayed usage is total minus available, so reserved filesystem space counts as unavailable. This measures capacity, not disk hardware health or individual directory sizes.

Machine responses add optional/nullable `resourceUsage`, containing those fields plus an ISO `sampledAt` timestamp assigned by the control plane when received. Old daemons omit `resources`: retain the previous sample without refreshing its timestamp. Explicit null clears it. Old clients ignore the new field; new clients accept old servers without the field.

A sample is stale after 90 seconds, or whenever the machine is not running. Missing samples display unavailable, never zero. A failed list request keeps the last values visible and retries automatically. Collection failure does not prevent heartbeat delivery. There are no notifications, thresholds, historical charts, or additional services.

## Rollout

1. Merge/deploy the control-plane change and apply its additive `0015_machine_resource_usage` migration through the usual deployment workflow.
2. Release/install the updated managed daemon on existing VPSs and configure provisioning to use that release.
3. Deploy the client. After the next heartbeat, the Machines cards show usage automatically.

The client and daemon can be deployed before the server safely, but metrics will remain unavailable until the server and its migration are deployed. Root-filesystem sampling covers the standard single-disk managed VPS layout; extra mounted volumes are outside this initial scope.
