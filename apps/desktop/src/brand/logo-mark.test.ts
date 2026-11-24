import { describe, expect, it } from "vitest";
import source from "../../../../brand/incoming/sources/logo-mark.svg?raw";
import { parseLogoMark } from "./logo-mark";

describe("parseLogoMark", () => {
  it("reads the checked-in mark, which the app colours", () => {
    const mark = parseLogoMark(source);
    expect(mark.viewBox).toMatch(/^[\d.-]+ [\d.-]+ [\d.]+ [\d.]+$/);
    // A fixed colour would vanish on one of the two themes.
    const fills = [...mark.body.matchAll(/\b(?:fill|stroke)="([^"]*)"/g)].map((match) => match[1]);
    expect(fills.filter((fill) => fill !== "currentColor" && fill !== "none")).toEqual([]);
  });

  it("keeps the shapes and drops the prolog, comments and root attributes", () => {
    const mark = parseLogoMark(
      `<?xml version="1.0"?>\n<!-- made in an editor -->\n<svg xmlns="http://www.w3.org/2000/svg" width="1024" viewBox="0 0 24 24" color="#000"><g><circle r="2"/><path d="M0 0"/></g></svg>\n`,
    );
    expect(mark).toEqual({ viewBox: "0 0 24 24", body: '<g><circle r="2"/><path d="M0 0"/></g>' });
  });

  it.each([
    ["no viewBox", '<svg><path d="M0 0"/></svg>', /viewBox/],
    ["nothing drawn", '<svg viewBox="0 0 1 1"> </svg>', /draws nothing/],
    ["a script", '<svg viewBox="0 0 1 1"><script>x()</script></svg>', /<script>/],
    ["an image", '<svg viewBox="0 0 1 1"><image href="a.png"/></svg>', /<image>/],
    ["an event handler", '<svg viewBox="0 0 1 1"><path onload="x()"/></svg>', /event handlers/],
    ["a link", '<svg viewBox="0 0 1 1"><g><path href="#a"/></g></svg>', /links/],
    ["two roots", '<svg viewBox="0 0 1 1"></svg><svg></svg>', /found <svg>/],
    ["text around the root", 'x<svg viewBox="0 0 1 1"><path/></svg>', /one <svg>/],
  ])("refuses %s", (_, svg, error) => {
    expect(() => parseLogoMark(svg)).toThrow(error);
  });
});
