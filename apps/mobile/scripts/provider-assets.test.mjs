import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it } from "vitest";
import { providerSvg } from "./provider-assets.mjs";

it.each(["codex", "claude", "opencode"])(
  "converts the actual %s desktop mark to a native asset",
  async (provider) => {
    const source = await readFile(
      new URL(`../../desktop/src/agents/paseo/${provider}-icon.tsx`, import.meta.url),
      "utf8",
    );
    const svg = providerSvg(source);
    const png = await sharp(Buffer.from(svg))
      .resize(72, 72, { fit: "contain", background: "#00000000" })
      .png()
      .toBuffer();
    const metadata = await sharp(png).metadata();
    expect(metadata).toMatchObject({ width: 72, height: 72, hasAlpha: true });
    expect(svg).not.toMatch(/[{}]/);
    if (provider === "opencode") expect(svg).toContain('opacity="0.4"');
  },
);
it("fails visibly if the desktop icon changes to unsupported markup", () => {
  expect(() => providerSvg("<svg />")).toThrow("Unsupported desktop provider icon");
  expect(() => providerSvg('<svg viewBox="0 0 24 24"><path d={path} /></svg>')).toThrow(
    "explicit SVG conversion",
  );
});
