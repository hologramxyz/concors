import { z } from "zod";

/** The label is for people; the ID is what resolves a chat across renames. */
export const SupervisorReferenceSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["Workspace", "Agent"]),
  label: z.string().min(1).max(200),
  workspace: z.string().max(200).optional(),
  pendingId: z.string().uuid().optional(),
});
export type SupervisorReference = z.infer<typeof SupervisorReferenceSchema>;
export const MAX_SUPERVISOR_REFERENCES = 8;
export const SupervisorReferencesSchema = z
  .array(SupervisorReferenceSchema)
  .max(MAX_SUPERVISOR_REFERENCES);

const marker = "\n\nConcors references (resolve by ID):\n";
export function withSupervisorReferences(text: string, references: readonly SupervisorReference[]) {
  return references.length
    ? text.trimEnd() + marker + references.map((reference) => JSON.stringify(reference)).join("\n")
    : text;
}

export function splitSupervisorReferences(text: string) {
  const index = text.lastIndexOf(marker);
  if (index >= 0) {
    try {
      const references = SupervisorReferencesSchema.parse(
        text
          .slice(index + marker.length)
          .split("\n")
          .map((line) => JSON.parse(line)),
      );
      if (references.length) return { text: text.slice(0, index), references };
    } catch {
      // A typed fragment or older stored message still renders as ordinary user text.
    }
  }
  return { text, references: [] };
}

/**
 * Where an `@` mention is being typed: the partial name between an `@` (at the start or after a
 * space) and the caret. Names have spaces, so the query may too; it ends at a line break.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\n@]{0,40})$/.exec(text.slice(0, caret));
  const query = match?.[2];
  return query === undefined ? null : { start: caret - query.length - 1, query };
}

/** Names that start with the query come first, then those that contain it; agents lead. */
export function matchReferences(
  references: readonly SupervisorReference[],
  query: string,
  limit = 8,
): SupervisorReference[] {
  const needle = query.trim().toLowerCase();
  const rank = (ref: SupervisorReference) => {
    const label = ref.label.toLowerCase();
    if (label.startsWith(needle)) return 0;
    if (label.includes(needle) || ref.workspace?.toLowerCase().includes(needle)) return 1;
    return -1;
  };
  return references
    .map((ref) => ({ ref, rank: rank(ref) }))
    .filter(({ rank }) => rank >= 0)
    .sort(
      (a, b) => a.rank - b.rank || Number(a.ref.kind !== "Agent") - Number(b.ref.kind !== "Agent"),
    )
    .slice(0, limit)
    .map(({ ref }) => ref);
}

/** Replaces the typed `@partial` with the full mention and a space, and says where the caret goes. */
export function insertMention(text: string, start: number, caret: number, label: string) {
  const after = text.slice(caret);
  // Reuse a space that already follows rather than doubling it.
  const mention = /^\s/.test(after) ? `@${label}` : `@${label} `;
  return {
    text: text.slice(0, start) + mention + after,
    caret: start + label.length + 2,
  };
}

/** The references whose mention is still in the text: deleting `@Name` drops its reference. */
export function mentionedReferences(text: string, references: readonly SupervisorReference[]) {
  return references.filter((ref) => text.includes(`@${ref.label}`));
}

/** The text in plain and mentioned pieces, so a sent message can show its mentions. */
export function mentionSegments(text: string, references: readonly SupervisorReference[]) {
  const labels = [...new Set(references.map((ref) => `@${ref.label}`))].sort(
    (a, b) => b.length - a.length,
  );
  if (!labels.length) return [{ text, mention: false }];
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return text
    .split(new RegExp(`(${escaped.join("|")})`))
    .filter(Boolean)
    .map((part) => ({ text: part, mention: labels.includes(part) }));
}
