// Adapted from Paseo a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6.
// Copyright (c) 2025-present Mohamed Boudra. Apache-2.0.
// See third-party/paseo-LICENSE. Extracted without provider-specific dependencies.
function unwrapShellCommand(command: string): string {
  const trimmed = command.trim();
  const unix = trimmed.match(/^(?:(?:\/[^/\s]+)*\/)?(?:zsh|bash|sh)\s+-(?:lc|c)\s+([\s\S]+)$/);
  if (unix?.[1]) return stripMatchingEdgeQuotes(unix[1].trim());

  const windows = trimmed.match(
    /^(?:"[^"]*\\)?(?:pwsh|powershell|cmd)(?:\.exe)?"?(?:\s+-[A-Za-z]+(?:\s+[^-\s][^\s]*)?)*\s+(?:-Command|-c|\/c)\s+([\s\S]+)$/i,
  );
  return windows?.[1] ? stripMatchingEdgeQuotes(windows[1].trim()) : trimmed;
}

function stripMatchingEdgeQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isWindowsShellCommand(command: string): boolean {
  const normalized = command.replace(/^["']|["']$/g, "");
  return /(?:^|\\)(?:pwsh|powershell|cmd)(?:\.exe)?$/i.test(normalized);
}

export function normalizeCommandExecutionCommand(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = unwrapShellCommand(value);
    return normalized.length > 0 ? normalized : undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length >= 3 && (parts[1] === "-lc" || parts[1] === "-c")) {
    const unwrapped = parts[2]?.trim();
    return unwrapped && unwrapped.length > 0 ? unwrapped : undefined;
  }
  if (
    parts.length >= 3 &&
    isWindowsShellCommand(parts[0] ?? "") &&
    /^(-command|-c|\/c)$/i.test(parts[1] ?? "")
  ) {
    const unwrapped = parts.slice(2).join(" ").trim();
    return unwrapped.length > 0 ? stripMatchingEdgeQuotes(unwrapped) : undefined;
  }
  return parts.join(" ");
}
