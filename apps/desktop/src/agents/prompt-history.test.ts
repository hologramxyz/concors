import { expect, it } from "vitest";
import type { AgentItem } from "@concors/protocol";
import { NO_RECALL, recallStep, sentPrompts, type PromptRecall } from "./prompt-history";

const history = ["first", "second\nwith two lines", "third"];
const press = (key: string, draft: string, recall: PromptRecall = NO_RECALL, caret = 0) =>
  recallStep({
    key,
    history,
    recall,
    draft,
    selectionStart: caret,
    selectionEnd: caret,
  });

it("lists a chat's sent prompts oldest first, once per run of repeats", () => {
  const item = (kind: AgentItem["kind"], text: string) => ({ kind, text }) as AgentItem;
  expect(
    sentPrompts([
      item("user", "a"),
      item("assistant", "reply"),
      item("user", "a"),
      item("user", "  "),
      item("user", "b"),
      item("user", "a"),
    ]),
  ).toEqual(["a", "b", "a"]);
});

it("Up from an empty box walks back through the prompts, Down returns to what was typed", () => {
  const first = press("ArrowUp", "");
  expect(first).toEqual({ recall: { index: 0, stash: "" }, draft: "third" });
  // The caret sits at the end of a recalled prompt, and Up still goes further back.
  const second = press("ArrowUp", "third", first!.recall, 5);
  expect(second?.draft).toBe("second\nwith two lines");
  const oldest = press("ArrowUp", second!.draft, second!.recall, 0);
  expect(oldest?.draft).toBe("first");
  expect(press("ArrowUp", "first", oldest!.recall, 0)).toBeNull();

  const back = press("ArrowDown", "first", oldest!.recall, 5);
  expect(back?.draft).toBe("second\nwith two lines");
  expect(press("ArrowDown", "third", first!.recall, 5)).toEqual({ recall: NO_RECALL, draft: "" });
});

it("keeps typed text: Up takes over only from the very start, and Down restores it", () => {
  expect(press("ArrowUp", "half typed", NO_RECALL, 4)).toBeNull();
  const up = press("ArrowUp", "half typed", NO_RECALL, 0);
  expect(up).toEqual({ recall: { index: 0, stash: "half typed" }, draft: "third" });
  expect(press("ArrowDown", "third", up!.recall, 5)).toEqual({
    recall: NO_RECALL,
    draft: "half typed",
  });
});

it("moves between the lines of a recalled prompt before stepping", () => {
  const recall = { index: 1, stash: "" };
  const draft = "second\nwith two lines";
  // On the second line, Up moves the caret to the first; on the first line, Down moves it down.
  expect(press("ArrowUp", draft, recall, 10)).toBeNull();
  expect(press("ArrowDown", draft, recall, 2)).toBeNull();
  expect(press("ArrowUp", draft, recall, 2)?.draft).toBe("first");
  expect(press("ArrowDown", draft, recall, 10)?.draft).toBe("third");
});

it("lets go once a recalled prompt is edited, or with text selected", () => {
  const recall = { index: 0, stash: "" };
  expect(press("ArrowUp", "third, edited", recall, 3)).toBeNull();
  expect(press("ArrowDown", "third, edited", recall, 13)).toBeNull();
  expect(
    recallStep({
      key: "ArrowUp",
      history,
      recall,
      draft: "third",
      selectionStart: 0,
      selectionEnd: 5,
    }),
  ).toBeNull();
  // A chat with nothing sent leaves Up to the caret.
  expect(
    recallStep({
      key: "ArrowUp",
      history: [],
      recall: NO_RECALL,
      draft: "",
      selectionStart: 0,
      selectionEnd: 0,
    }),
  ).toBeNull();
});
