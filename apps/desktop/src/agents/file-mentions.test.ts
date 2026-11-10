import { expect, it } from "vitest";
import { findFileMentions, isFileMention } from "./file-mentions";

const mentions = (text: string) => findFileMentions(text).map((m) => m.href);

it("finds the files an agent names in plain text", () => {
  expect(
    mentions(
      "Files are in /home/ubuntu/concors-x/strategy-2026-11: concors-roadmap-2026-11-09.md, " +
        "orchestration-ux-2026-11-09.md and mock/delegate-proposal.png.",
    ),
  ).toEqual([
    "concors-roadmap-2026-11-09.md",
    "orchestration-ux-2026-11-09.md",
    "mock/delegate-proposal.png",
  ]);
  expect(mentions("See src/agents/chat.tsx:513 and ./docs/plan.md (and ../README.md)")).toEqual([
    "src/agents/chat.tsx:513",
    "./docs/plan.md",
    "../README.md",
  ]);
  expect(mentions("Updated /home/ubuntu/app/package.json and Dockerfile.dev")).toEqual([
    "/home/ubuntu/app/package.json",
  ]);
  expect(mentions("archive.tar.gz is ready")).toEqual(["archive.tar.gz"]);
});

it("leaves words, versions, URLs and directories alone", () => {
  expect(
    mentions(
      "Node.js and Next.js on concors.dev, v0.14.0, e.g. this, and/or that, TCP/IP, 1/2, " +
        "research/ and /home/ubuntu/concors-x/strategy-2026-11, " +
        "https://example.com/logo.png, ~/notes/todo.md, C:\\work\\a.md, end.",
    ),
  ).toEqual([]);
});

it("treats inline code as a file only when all of it is one", () => {
  expect(isFileMention("src/app.ts")).toBe(true);
  expect(isFileMention("plan.md")).toBe(true);
  expect(isFileMention("cat src/app.ts")).toBe(false);
  expect(isFileMention("npm run build")).toBe(false);
});
