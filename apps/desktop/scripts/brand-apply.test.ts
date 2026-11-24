import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyBrand, faviconFrom, GENERATORS, type Generator } from "./brand-apply.ts";

let root: string;
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** A source that makes `app/big.png` and `app/small.png`, and a store image made from big.png. */
function setUp() {
  write(
    "brand/incoming/manifest.json",
    JSON.stringify({
      sources: {
        "sources/icon.svg": { copyTo: ["app/icon.svg"], regenerate: ["icons"] },
        "sources/mark.svg": { readBy: ["app/ui.tsx"] },
      },
      files: { "out/big.png": ["app/big.png"], "out/small.png": ["app/small.png"] },
    }),
  );
  for (const [path, text] of [
    ["sources/icon.svg", "v1"],
    ["sources/mark.svg", "mark"],
    ["out/big.png", "big v1"],
    ["out/small.png", "small v1"],
  ] as const)
    write(`brand/incoming/${path}`, text);
  write("app/icon.svg", "v1");
  write("app/big.png", "big v1");
  write("app/small.png", "small v1");
  write("store/icon.png", "store of big v1");
}

const runs: string[] = [];
const generators: Record<string, Generator> = {
  icons: {
    outputs: ["app/big.png", "app/small.png"],
    run() {
      runs.push("icons");
      const version = read("app/icon.svg");
      write("app/big.png", `big ${version}`);
      write("app/small.png", `small ${version}`);
    },
  },
  store: {
    inputs: ["app/big.png"],
    outputs: ["store/icon.png"],
    run() {
      runs.push("store");
      write("store/icon.png", `store of ${read("app/big.png")}`);
    },
  },
};
const apply = (check = false) => {
  const lines: string[] = [];
  const result = applyBrand({ root, check, generators, log: (line) => lines.push(line) });
  return { ...result, lines };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "brand-apply-"));
  runs.length = 0;
  setUp();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("applyBrand", () => {
  it("changes nothing when the folder matches the apps", () => {
    expect(apply(true)).toMatchObject({ differences: [] });
    const result = apply();
    expect(result.changed).toEqual([]);
    expect(result.lines).toEqual(["Nothing to change: brand/incoming matches the apps."]);
    expect(runs).toEqual([]);
  });

  it("regenerates from a changed source and keeps the folder's copies current", () => {
    write("brand/incoming/sources/icon.svg", "v2");
    expect(apply(true).differences).toEqual([
      "brand/incoming/sources/icon.svg changed: would regenerate icons",
    ]);
    expect(read("app/icon.svg")).toBe("v1");

    const { changed } = apply();
    expect(runs).toEqual(["icons", "store"]);
    expect(read("app/big.png")).toBe("big v2");
    expect(read("brand/incoming/out/big.png")).toBe("big v2");
    expect(read("store/icon.png")).toBe("store of big v2");
    expect(changed).toEqual([
      "app/big.png",
      "app/icon.svg",
      "app/small.png",
      "brand/incoming/out/big.png",
      "brand/incoming/out/small.png",
      "store/icon.png",
    ]);
    expect(apply().changed).toEqual([]);
  });

  it("lets a file dropped in by hand win over the regenerated one", () => {
    write("brand/incoming/sources/icon.svg", "v2");
    write("brand/incoming/out/small.png", "hand-tuned small");
    apply();
    expect(read("app/big.png")).toBe("big v2");
    expect(read("app/small.png")).toBe("hand-tuned small");
    expect(read("brand/incoming/out/small.png")).toBe("hand-tuned small");
  });

  it("copies a hand-dropped file without regenerating, and re-renders what shows it", () => {
    write("brand/incoming/out/big.png", "hand-tuned big");
    expect(apply(true).differences).toEqual([
      "brand/incoming/out/big.png differs from app/big.png",
    ]);
    const { changed } = apply();
    expect(runs).toEqual(["store"]);
    expect(read("store/icon.png")).toBe("store of hand-tuned big");
    expect(changed).toEqual(["app/big.png", "store/icon.png"]);
  });

  it("skips files the manifest does not place, and refuses missing ones", () => {
    write("brand/incoming/out/extra.png", "?");
    expect(apply().lines[0]).toBe(
      "Skipped brand/incoming/out/extra.png: manifest.json does not say where it goes",
    );
    rmSync(join(root, "brand/incoming/out/small.png"));
    expect(() => apply()).toThrow(
      "brand/incoming/out/small.png is in manifest.json but not in the folder",
    );
  });
});

describe("the real manifest", () => {
  const repo = join(import.meta.dirname, "../../..");
  const manifest = JSON.parse(readFileSync(join(repo, "brand/incoming/manifest.json"), "utf8"));

  it("names only generators that exist", () => {
    for (const source of Object.values<{ regenerate?: string[] }>(manifest.sources))
      for (const name of source.regenerate ?? []) expect(GENERATORS).toHaveProperty(name);
  });

  it("matches the apps today", () => {
    const lines: string[] = [];
    expect(
      applyBrand({ root: repo, check: true, log: (line) => lines.push(line) }).differences,
    ).toEqual([]);
  });
});

describe("faviconFrom", () => {
  it("drops the render size from the root element only", () => {
    expect(
      faviconFrom(
        '<svg width="1024" height="1024" viewBox="0 0 96 96"><rect width="96" height="96"/></svg>',
      ),
    ).toBe('<svg viewBox="0 0 96 96"><rect width="96" height="96"/></svg>');
  });

  it("turns today's app icon into today's favicon", () => {
    const repo = join(import.meta.dirname, "../../..");
    expect(
      faviconFrom(readFileSync(join(repo, "apps/desktop/src-tauri/icons/source.svg"), "utf8")),
    ).toBe(readFileSync(join(repo, "apps/desktop/public/favicon.svg"), "utf8"));
  });
});
