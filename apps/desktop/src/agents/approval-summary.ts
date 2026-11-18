import type { AgentPending } from "@concors/protocol";

/** Keep provider payloads in Details. The lead shows the command or the path a person can review. */
export function approvalSummary(pending: AgentPending): string {
  if (pending.kind !== "approval") return pending.summary;
  const [first = "", reason = ""] = pending.summary.split("\n");
  const line = first.trim();
  const shortReason = reason.startsWith("Network access:") ? "Requests network access" : reason;
  if (!/^\{\s*"|^\[\s*"/.test(line))
    return [first, shortReason].filter(Boolean).join("\n").slice(0, 600);
  try {
    const raw: unknown = JSON.parse(line);
    if (Array.isArray(raw) && raw.every((entry) => typeof entry === "string"))
      return raw.join(", ").slice(0, 400);
    if (raw && typeof raw === "object") {
      if ("file_path" in raw && typeof raw.file_path === "string")
        return [shortReason, raw.file_path].filter(Boolean).join(" · ").slice(0, 600);
      if ("command" in raw && typeof raw.command === "string") return raw.command.slice(0, 600);
    }
  } catch {
    // A large generated payload can be truncated by the provider.
  }
  return shortReason && !/^(?:\{|\[)/.test(shortReason.trim()) ? shortReason.slice(0, 400) : "";
}
