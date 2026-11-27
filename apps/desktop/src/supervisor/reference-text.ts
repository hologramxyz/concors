import type { ClipboardEvent } from "react";
import { z } from "zod";
import { SUPERVISOR_REFERENCES_MARKER as marker } from "@concors/protocol";

/** The label is for people; the ID is what resolves a chat across renames. */
export const SupervisorReferenceSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["Workspace", "Agent"]),
  label: z.string().min(1).max(200),
  workspace: z.string().max(200).optional(),
});
export type SupervisorReference = z.infer<typeof SupervisorReferenceSchema>;
export const MAX_SUPERVISOR_REFERENCES = 8;
/** A name as a reference carries it, within the schema's bounds however the session is named. */
export const referenceLabel = (name: string) => name.trim().slice(0, 200) || "Untitled";
export const SupervisorReferencesSchema = z
  .array(SupervisorReferenceSchema)
  .max(MAX_SUPERVISOR_REFERENCES);

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

/**
 * The mention list in two parts: open chats and workspaces, ranked and limited as
 * `matchReferences` does, then the closed chats, folded under Closed. The fold is shut until it is
 * opened, unless a name is being typed: then the closed chats that match show without opening it,
 * since a name typed is a chat looked for. `unfolded` is the person's own choice, null until they
 * make one. `closedMatches` says whether the fold has anything in it at all.
 */
export function mentionGroups(
  references: readonly SupervisorReference[],
  closed: ReadonlySet<string>,
  query: string,
  unfolded: boolean | null,
  limit = 8,
) {
  const isClosed = (ref: SupervisorReference) => ref.kind === "Agent" && closed.has(ref.id);
  const open = matchReferences(
    references.filter((ref) => !isClosed(ref)),
    query,
    limit,
  );
  const closedMatches = matchReferences(references.filter(isClosed), query, limit);
  const closedOpen = closedMatches.length > 0 && (unfolded ?? !!query.trim());
  return {
    open,
    closed: closedOpen ? closedMatches : [],
    closedOpen,
    closedMatches: closedMatches.length,
    /** Every row in order, for the keys that move through them. */
    rows: closedOpen ? [...open, ...closedMatches] : open,
  };
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

/**
 * Where the live mentions are in a draft: each `@Name` of a chosen reference still in the text,
 * cut exactly as a sent message cuts its chips, so what is tinted is what will be sent.
 */
export function mentionRanges(text: string, selected: readonly SupervisorReference[]) {
  const ranges: { start: number; end: number }[] = [];
  let at = 0;
  for (const part of mentionSegments(text, mentionedReferences(text, selected))) {
    if (part.mention) ranges.push({ start: at, end: at + part.text.length });
    at += part.text.length;
  }
  return ranges;
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

/**
 * Copies a selection with each chip as the text it stands for: a mention as the "@Name" it was
 * written as, a linked chat as its link text. Left to the browser, a chip's icon box would break
 * the line before it.
 */
export function copyChips(event: ClipboardEvent<HTMLElement>) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const fragment = selection.getRangeAt(0).cloneContents();
  const chips = fragment.querySelectorAll<HTMLElement>("[data-mention], [data-chat-link]");
  if (!chips.length) return;
  for (const chip of chips)
    chip.replaceWith(
      "mention" in chip.dataset
        ? `@${chip.dataset["mention"] ?? ""}`
        : (chip.lastElementChild?.textContent ?? ""),
    );
  event.clipboardData.setData("text/plain", fragment.textContent ?? "");
  event.preventDefault();
}
