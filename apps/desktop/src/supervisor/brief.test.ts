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
  expect(briefLine("The fixture test suite finished. All checks passed.")).toBe(
    "The fixture test suite finished. All checks passed.",
  );
  const long = `${"The rail clips at narrow widths because the grid has no minimum. ".repeat(4)}`;
  expect(briefLine(long)).toBe("The rail clips at narrow widths because the grid has no minimum.");
  expect(briefLine("## Summary\n\n- Added `sub` to [math.js](src/math.js)\n- Ran 43 tests")).toBe(
    "1 of 2: Added sub to math.js",
  );
  expect(
    briefLine(
      "1. **S1: `DELETE /orders` with no header.** This returns 204 today because nothing checks the token, so anyone can delete. It matters most because it is destructive and unguarded, and the test should assert 401.\n\n2. **S3: `admin`.** A backdoor.\n\n3. **S2: prefix.** Too lax.",
    ),
  ).toBe("1 of 3: S1: DELETE /orders with no header.");
  // A title names the reply; the prose after it says what it found.
  expect(
    briefLine("**Subtraction: The Arithmetic of Difference**\n\nSubtraction is often introduced."),
  ).toBe("Subtraction is often introduced.");
  expect(briefLine("# Test plan for routes.js\n\nIt covers auth, deletes and 404s.")).toBe(
    "It covers auth, deletes and 404s.",
  );
  expect(briefLine("# Only a title")).toBe("Only a title");
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
  expect(briefLine("x".repeat(400))).toHaveLength(300);
});
