import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileTypeIcon } from "./file-type-icon";

const icon = (path: string) => renderToStaticMarkup(createElement(FileTypeIcon, { path }));

describe("file type icons", () => {
  it("uses the basename, case-insensitive extensions, and compound file types", () => {
    expect(icon("src/main.TS")).toBe(icon("main.ts"));
    expect(icon("C:\\repo\\package.json")).toBe(icon("package.json"));
    expect(icon("src/Widget.tsx")).not.toBe(icon("src/Widget.ts"));
    expect(icon("types/global.d.ts")).not.toBe(icon("global.ts"));
    expect(icon("package.json")).not.toBe(icon("data.json"));
  });

  it("recognizes common module, documentation, and configuration variants", () => {
    expect(icon("main.mts")).toBe(icon("main.ts"));
    expect(icon("main.cts")).toBe(icon("main.ts"));
    expect(icon("README.markdown")).toBe(icon("README.md"));
    expect(icon("settings.jsonc")).toBe(icon("settings.json"));
    expect(icon("config.yaml")).toBe(icon("config.yml"));
    expect(icon(".env.staging.local")).toBe(icon(".env"));
    expect(icon("Dockerfile.production")).toBe(icon("Dockerfile"));
  });

  it("keeps unknown files visible without changing the accessible filename", () => {
    const fallback = icon("unknown.extension");
    expect(fallback).toBe(icon("extensionless"));
    for (const name of ["constructor", "__proto__", "file.constructor", "file.__proto__"])
      expect(icon(name)).toBe(fallback);
    expect(fallback).toContain("<svg");
    expect(fallback).toContain('aria-hidden="true"');
    expect(fallback).toContain('focusable="false"');
    expect(icon("app.js")).not.toBe(fallback);
    expect(icon("config.yaml")).not.toBe(fallback);
    expect(icon("README.md")).not.toBe(fallback);
  });
});
