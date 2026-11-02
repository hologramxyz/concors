import { expect, it } from "vitest";
import { tildePath } from "./home-path";

it("replaces only a whole home folder with a tilde", () => {
  expect(tildePath("/Users/ann/Documents/concors", "/Users/ann")).toBe("~/Documents/concors");
  expect(tildePath("/Users/ann", "/Users/ann/")).toBe("~");
  expect(tildePath("/Users/anna/concors", "/Users/ann")).toBe("/Users/anna/concors");
  expect(tildePath("/srv/concors", "/Users/ann")).toBe("/srv/concors");
  expect(tildePath("C:\\Users\\ann\\concors", "C:\\Users\\ann")).toBe("~\\concors");
});

it("shows the full path until the machine has said where home is", () => {
  expect(tildePath("/Users/ann/concors", null)).toBe("/Users/ann/concors");
});
