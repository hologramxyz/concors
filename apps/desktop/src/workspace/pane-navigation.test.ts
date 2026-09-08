import { expect, it } from "vitest";
import { neighborPane } from "./pane-navigation";
const panes = [
  { id: "left", left: 0, top: 0, right: 400, bottom: 800 },
  { id: "top", left: 408, top: 0, right: 1000, bottom: 200 },
  { id: "bottom", left: 408, top: 208, right: 1000, bottom: 800 },
];
it("navigates unequal nested panes by geometry, with no edge wrapping", () => {
  expect(neighborPane(panes, "left", "right")).toBe("bottom");
  expect(neighborPane(panes, "top", "down")).toBe("bottom");
  expect(neighborPane(panes, "bottom", "up")).toBe("top");
  expect(neighborPane(panes, "top", "left")).toBe("left");
  expect(neighborPane(panes, "left", "left")).toBeNull();
  expect(neighborPane(panes, "missing", "right")).toBeNull();
});
