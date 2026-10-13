import { describe, expect, it } from "vitest";
import { previewMime } from "./preview.ts";

const bytes = (text: string) => Buffer.from(text, "latin1");

describe("preview types", () => {
  it("recognises each supported signature", () => {
    expect(previewMime(bytes("%PDF-1.4"))).toBe("application/pdf");
    // Some generators put bytes before the header; readers allow it within the first kilobyte.
    expect(previewMime(bytes("\r\n\r\n%PDF-1.4"))).toBe("application/pdf");
    expect(previewMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(previewMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(previewMime(bytes("GIF89a"))).toBe("image/gif");
    expect(previewMime(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("refuses everything else", () => {
    expect(previewMime(bytes(""))).toBeNull();
    expect(previewMime(bytes("plain text"))).toBeNull();
    expect(previewMime(bytes("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(previewMime(bytes(`${" ".repeat(1024)}%PDF-1.4`))).toBeNull();
  });
});
