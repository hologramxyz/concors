import { expect, it } from "vitest";
import { shortPath } from "./short-path";

const home = "/Users/me";
const workspace = "/Users/me/Documents/Holo Work/Animation Test";

it("writes a path inside the workspace relative to its folder", () => {
  expect(shortPath(`${workspace}/concors-test/math.js`, [workspace], home)).toBe(
    "concors-test/math.js",
  );
  expect(shortPath(`${workspace}/concors-test/math.js`, [`${workspace}/`], home)).toBe(
    "concors-test/math.js",
  );
});

it("uses the deepest workspace that holds the path", () => {
  expect(shortPath(`${workspace}/app/src/a.ts`, [workspace, `${workspace}/app`], home)).toBe(
    "src/a.ts",
  );
});

it("writes home as ~ outside every workspace", () => {
  expect(shortPath("/Users/me/.zshrc", [workspace], home)).toBe("~/.zshrc");
  expect(shortPath("/etc/hosts", [workspace], home)).toBe("/etc/hosts");
  expect(shortPath("/etc/hosts", [workspace], null)).toBe("/etc/hosts");
});

it("does not take a sibling folder with the same prefix for the workspace", () => {
  expect(shortPath(`${workspace} 2/a.js`, [workspace], home)).toBe(
    "~/Documents/Holo Work/Animation Test 2/a.js",
  );
});

it("leaves a path the agent already wrote relative as it is", () => {
  expect(shortPath("src/a.ts", [workspace], home)).toBe("src/a.ts");
});
