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
