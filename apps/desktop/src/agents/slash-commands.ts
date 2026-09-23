import type { AgentCommand } from "@concors/protocol";

// The slash menu only offers what the provider reported in its controls. Concors never invents a
// command a provider cannot run, so an agent without reported commands simply shows no menu; the
// daemon still rejects an unknown `/name` rather than sending it as a prompt.

/** The partial command name being typed, or null once the draft is not a bare `/name`. */
export function slashQuery(draft: string): string | null {
  const match = /^\/([\w:-]*)$/.exec(draft);
  return match ? (match[1] ?? "") : null;
}

/** Commands whose name starts with the query come first, then those that merely contain it. */
export function matchCommands(commands: readonly AgentCommand[], query: string): AgentCommand[] {
  const needle = query.toLowerCase();
  const prefix: AgentCommand[] = [];
  const contains: AgentCommand[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) prefix.push(command);
    else if (needle && name.includes(needle)) contains.push(command);
  }
  return [...prefix, ...contains];
}

/**
 * A command runs as soon as it is chosen unless its hint names an argument it cannot run without.
 * Bracketed hints such as Claude's `[instructions]` are optional, so `/compact` runs directly.
 */
export function needsArguments(command: AgentCommand): boolean {
  const hint = command.argumentHint?.trim();
  return !!hint && !hint.startsWith("[");
}
