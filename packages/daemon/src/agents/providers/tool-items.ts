const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const outputText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(outputText).filter(Boolean).join("\n");
  const item = record(value);
  return text(item["text"]) || outputText(item["content"] ?? item["output"] ?? "");
};

/** Preserve native tool semantics without assuming every tool is an MCP call. */
export function nativeToolItem(
  id: string,
  name: string,
  input: unknown,
  output: unknown,
  done: boolean,
  failed: boolean,
): Record<string, unknown> {
  const args = record(input),
    result = record(output),
    details = record(result["details"] ?? result["metadata"]);
  const normalized = name.toLowerCase().replaceAll("-", "_");
  const base = { id, status: failed ? "failed" : done ? "completed" : "inProgress" };
  if (["bash", "shell", "exec_command", "terminal", "execute", "run_command"].includes(normalized))
    return {
      ...base,
      type: "commandExecution",
      command: args["command"] ?? args["cmd"] ?? name,
      cwd: text(args["cwd"] ?? args["workdir"]),
      aggregatedOutput: outputText(output),
      exitCode: result["exitCode"] ?? details["exitCode"],
    };
  if (
    [
      "edit",
      "write",
      "multiedit",
      "apply_patch",
      "str_replace",
      "edit_file",
      "write_file",
    ].includes(normalized)
  ) {
    const path = text(args["file_path"] ?? args["filePath"] ?? args["path"]);
    const diff = text(details["diff"] ?? result["diff"]);
    const edits = Array.isArray(args["edits"]) ? args["edits"].map(record) : [args];
    const changes = edits
      .map((edit) => {
        const before = edit["old_string"] ?? edit["oldText"] ?? edit["old_text"],
          after = edit["new_string"] ?? edit["newText"] ?? edit["new_text"];
        // These are the snippets the CLI reported, not an inferred whole-file diff.
        const snippet =
          typeof before === "string" && typeof after === "string"
            ? before
                .split("\n")
                .map((l) => "-" + l)
                .join("\n") +
              "\n" +
              after
                .split("\n")
                .map((l) => "+" + l)
                .join("\n")
            : "";
        return {
          path: text(edit["file_path"] ?? edit["filePath"] ?? edit["path"]) || path,
          diff: diff || snippet,
        };
      })
      .filter((change) => change.path);
    return { ...base, type: "fileChange", changes, nativeInput: input, nativeOutput: output };
  }
  if (["read", "read_file", "view", "cat"].includes(normalized))
    return {
      ...base,
      type: "fileRead",
      path: text(args["file_path"] ?? args["filePath"] ?? args["path"]),
      output: outputText(output),
    };
  if (
    [
      "grep",
      "glob",
      "find",
      "search",
      "rg",
      "websearch",
      "web_search",
      "webfetch",
      "web_fetch",
    ].includes(normalized)
  )
    return {
      ...base,
      type: "search",
      query: text(args["pattern"] ?? args["query"] ?? args["url"] ?? args["path"]),
      tool: name,
      output: outputText(output),
    };
  if (["agent", "task", "subagent", "spawn_agent", "dispatch_agent"].includes(normalized)) {
    const child = text(
      details["sessionId"] ??
        details["sessionID"] ??
        result["sessionId"] ??
        result["sessionID"] ??
        result["agentId"],
    );
    return {
      ...base,
      type: "collabAgentToolCall",
      tool: name,
      prompt: text(args["description"] ?? args["prompt"] ?? args["task"]),
      receiverThreadIds: child ? [child] : [],
      agentsStates: child
        ? {
            [child]: {
              status: failed ? "failed" : done ? "completed" : "running",
              message: outputText(output) || null,
            },
          }
        : {},
      output: outputText(output),
    };
  }
  return { ...base, type: "mcpToolCall", tool: name, arguments: input, result: output };
}
