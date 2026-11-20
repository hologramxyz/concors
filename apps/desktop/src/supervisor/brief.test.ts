import { expect, it } from "vitest";
import { briefLine } from "./brief";

it("summarizes replies by their opening sentence, without Markdown or code", () => {
  expect(
    briefLine(
      "I added one line to `math.js`, directly below `add`:\n\n```js\nexport function sub(a, b) { return a - b; }\n```\n\nIt uses the same style.",
    ),
  ).toBe("I added one line to math.js, directly below add");
  expect(
    briefLine(
      "Both chats finished, and I checked the files on disk in each workspace.\n- **ws-alpha**: added a line",
    ),
  ).toBe("Both chats finished, and I checked the files on disk in each workspace.");
  expect(briefLine("## Summary\n\n- Added `sub` to [math.js](src/math.js)\n- Ran 43 tests")).toBe(
    "Added sub to math.js",
  );
  expect(
    briefLine("**Subtraction: The Arithmetic of Difference**\n\nSubtraction is often introduced."),
  ).toBe("Subtraction: The Arithmetic of Difference");
});

it("prefers a line the agent marked as its TL;DR or summary", () => {
  expect(
    briefLine("Long investigation first.\n\n**TL;DR:** The flaky test needs a fixed seed."),
  ).toBe("The flaky test needs a fixed seed.");
  expect(briefLine("Details...\nSummary: 3 files changed, all tests pass.")).toBe(
    "3 files changed, all tests pass.",
  );
});

it("keeps short or empty replies and bounds long ones", () => {
  expect(briefLine("")).toBe("");
  expect(briefLine("```\nonly code\n```")).toBe("");
  expect(briefLine("Done.")).toBe("Done.");
  expect(briefLine("x".repeat(400))).toHaveLength(160);
});
