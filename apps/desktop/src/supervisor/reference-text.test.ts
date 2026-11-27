import { describe, expect, it } from "vitest";
import {
  insertMention,
  matchReferences,
  mentionQuery,
  mentionRanges,
  mentionSegments,
  mentionedReferences,
  type SupervisorReference,
} from "./reference-text";

const qa: SupervisorReference = {
  id: "00000000-0000-4000-8000-000000000001",
  kind: "Agent",
  label: "Game QA",
  workspace: "Star Catcher",
};
const game: SupervisorReference = {
  id: "00000000-0000-4000-8000-000000000002",
  kind: "Workspace",
  label: "Star Catcher",
};

it("finds the mention being typed at the caret, names with spaces included", () => {
  expect(mentionQuery("Ask @Gam", 8)).toEqual({ start: 4, query: "Gam" });
  expect(mentionQuery("@Game Q", 7)).toEqual({ start: 0, query: "Game Q" });
  expect(mentionQuery("mail me@example.com", 19)).toBeNull();
  expect(mentionQuery("Ask @Game\nnext", 14)).toBeNull();
  expect(mentionQuery("Ask @", 5)).toEqual({ start: 4, query: "" });
});

it("ranks prefix matches first and agents before workspaces", () => {
  expect(matchReferences([game, qa], "")).toEqual([qa, game]);
  expect(matchReferences([game, qa], "star")).toEqual([game, qa]);
  expect(matchReferences([game, qa], "qa")).toEqual([qa]);
  expect(matchReferences([game, qa], "zzz")).toEqual([]);
});

it("inserts the mention in place, keeps only mentions still written, and marks them", () => {
  expect(insertMention("Ask @ga now", 4, 7, "Game QA")).toEqual({
    text: "Ask @Game QA now",
    caret: 13,
  });
  expect(insertMention("Ask @ga", 4, 7, "Game QA")).toEqual({ text: "Ask @Game QA ", caret: 13 });
  expect(mentionedReferences("Ask @Game QA to rerun", [qa, game])).toEqual([qa]);
  expect(mentionSegments("Ask @Game QA to rerun", [qa])).toEqual([
    { text: "Ask ", mention: false },
    { text: "@Game QA", mention: true },
    { text: " to rerun", mention: false },
  ]);
});

describe("mentionRanges", () => {
  const cut = (text: string, refs: readonly SupervisorReference[]) =>
    mentionRanges(text, refs).map(({ start, end }) => text.slice(start, end));

  it("tints a chosen mention, @ included, and nothing else", () => {
    const text = "Ask @Game QA to rerun";
    expect(mentionRanges(text, [qa])).toEqual([{ start: 4, end: 12 }]);
    expect(cut(text, [qa])).toEqual(["@Game QA"]);
  });

  it("leaves a hand-typed @Name alone when nothing was chosen for it", () => {
    expect(mentionRanges("Ask @Game QA to rerun", [])).toEqual([]);
    expect(cut("Ask @Game QA in @Star Catcher", [qa])).toEqual(["@Game QA"]);
  });

  it("drops the tint once a letter inside the mention is edited, as sending does", () => {
    expect(mentionRanges("Ask @Game Q to rerun", [qa])).toEqual([]);
    expect(mentionRanges("Ask @Gme QA to rerun", [qa])).toEqual([]);
  });

  it("tints every occurrence once, however many references share the name", () => {
    const twin: SupervisorReference = { ...qa, id: "00000000-0000-4000-8000-000000000009" };
    expect(cut("@Game QA and @Game QA", [qa, twin])).toEqual(["@Game QA", "@Game QA"]);
    expect(mentionRanges("@Game QA and @Game QA", [qa, twin])).toEqual([
      { start: 0, end: 8 },
      { start: 13, end: 21 },
    ]);
  });

  it("tints a mention at the very start and at the very end", () => {
    const text = "@Game QA then @Star Catcher";
    expect(mentionRanges(text, [qa, game])).toEqual([
      { start: 0, end: 8 },
      { start: 14, end: 27 },
    ]);
  });
});
