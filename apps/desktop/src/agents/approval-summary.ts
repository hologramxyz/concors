import type { AgentPending } from "@concors/protocol";

/** The daemon's lines for what an approval would widen beyond the request itself. */
const GRANT = /^(?:Folder: |Network access:)/;

/**
 * Keep provider payloads in Details. The lead shows the command or the path a person can review,
 * and what approving would widen (a folder, network access) always stays in view below it.
 */
export function approvalSummary(pending: AgentPending): string {
  if (pending.kind !== "approval") return pending.summary;
  const lines = pending.summary.split("\n");
  const grants = lines
    .filter((line) => GRANT.test(line))
    .map((line) => (line.startsWith("Folder: ") ? line.slice(0, 400) : "Requests network access"));
  const [first = "", ...reasons] = lines.filter((line) => !GRANT.test(line));
  return [lead(first, reasons.join("\n")), ...grants].filter(Boolean).join("\n");
}

function lead(first: string, reason: string): string {
  const line = first.trim();
  if (!/^\{\s*"|^\[\s*"/.test(line))
    return [first, reason].filter(Boolean).join("\n").slice(0, 600);
  try {
    const raw: unknown = JSON.parse(line);
    if (Array.isArray(raw) && raw.every((entry) => typeof entry === "string"))
      return raw.join(", ").slice(0, 400);
    if (raw && typeof raw === "object") {
      if ("file_path" in raw && typeof raw.file_path === "string")
        return [reason, raw.file_path].filter(Boolean).join(" · ").slice(0, 600);
      if ("command" in raw && typeof raw.command === "string") return raw.command.slice(0, 600);
    }
  } catch {
    // A large generated payload can be truncated by the provider.
  }
  return reason && !/^(?:\{|\[)/.test(reason.trim()) ? reason.slice(0, 400) : "";
}
