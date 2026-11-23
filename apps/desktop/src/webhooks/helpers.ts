import type { AgentInfo, AgentTrigger } from "@concors/protocol";
import type { Host } from "@concors/client-core";

export function createdTriggerId(
  before: AgentTrigger[],
  after: AgentTrigger[],
  secret: string,
): string | null {
  const created = after.filter(
    (trigger) =>
      !before.some((old) => old.id === trigger.id) && trigger.secretHint === secret.slice(-4),
  );
  return created.length === 1 ? (created[0]?.id ?? null) : null;
}

export function webhookHostname(host: Host): string | null {
  if (host.machineId === "local") return null;
  const direct = host.connections.find((c) => c.kind === "direct");
  if (!direct) return null;
  try {
    const url = new URL(direct.url);
    return url.protocol === "wss:" ? url.hostname : null;
  } catch {
    return null;
  }
}

export function webhookUrl(hostname: string | null, id: string): string | null {
  if (!hostname) return null;
  try {
    const url = new URL(`https://${hostname}`);
    if (
      url.hostname !== hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return `${url.origin}/hooks/${encodeURIComponent(id)}`;
  } catch {
    return null;
  }
}
export function webhookCurl(url: string | null, secret: string): string {
  if (!url) return "";
  const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
  return [
    `curl -X POST ${quote(url)}`,
    `  -H ${quote(`Authorization: Bearer ${secret}`)}`,
    "  -H 'Idempotency-Key: abc'",
    "  -H 'X-Concors-Source: stream'",
    "  -H 'Content-Type: application/json'",
    `  -d '{"note":"..."}'`,
  ].join(" \\\n");
}
export function triggerTargetLabel(trigger: AgentTrigger, agents: AgentInfo[]): string {
  if (trigger.target.kind === "supervisor") return "Supervisor";
  const id =
    trigger.sessionId ?? (trigger.target.kind === "session" ? trigger.target.sessionId : null);
  return (
    agents.find((a) => a.id === id)?.name ??
    (trigger.target.kind === "agent" ? `New ${trigger.target.provider} chat` : "Chat unavailable")
  );
}
