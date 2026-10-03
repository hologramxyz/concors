import { expect, it } from "vitest";

import {
  hasAuthenticodeSignature,
  WINDOWS_SIGNING_VARIABLES,
  windowsSigning,
} from "./windows-signing.ts";

const configured = {
  AZURE_CLIENT_ID: "client",
  AZURE_CLIENT_SECRET: "secret",
  AZURE_TENANT_ID: "tenant",
  AZURE_ARTIFACT_SIGNING_ENDPOINT: "https://weu.codesigning.azure.net",
  AZURE_ARTIFACT_SIGNING_ACCOUNT: "concors",
  AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE: "public",
};

it("builds unsigned when nothing is configured", () => {
  expect(windowsSigning({})).toBeNull();
  expect(windowsSigning({ AZURE_CLIENT_ID: " " })).toBeNull();
});

it("signs with the configured account and certificate profile", () => {
  expect(windowsSigning(configured)).toEqual({
    tool: "artifact-signing-cli",
    args: [
      "-e",
      "https://weu.codesigning.azure.net",
      "-a",
      "concors",
      "-c",
      "public",
      "-d",
      "Concors",
    ],
  });
});

// A release with one secret missing must fail, not quietly publish an unsigned installer.
it("names what is missing from a partial configuration", () => {
  for (const name of WINDOWS_SIGNING_VARIABLES) {
    const partial = Object.fromEntries(Object.entries(configured).filter(([key]) => key !== name));
    expect(() => windowsSigning(partial)).toThrow(name);
  }
});

/** The start of a PE image: DOS stub, PE signature, COFF header and optional header. */
function image(magic: number, certificateTableSize: number): Buffer {
  const header = Buffer.alloc(1024);
  header.write("MZ", 0, "latin1");
  const pe = 0x80;
  header.writeUInt32LE(pe, 0x3c);
  header.write("PE\0\0", pe, "latin1");
  const optional = pe + 24;
  header.writeUInt16LE(magic, optional);
  const directories = optional + (magic === 0x20b ? 112 : 96);
  header.writeUInt32LE(certificateTableSize ? 0x5000 : 0, directories + 4 * 8);
  header.writeUInt32LE(certificateTableSize, directories + 4 * 8 + 4);
  return header;
}

// node.exe and ConPTY arrive signed by their publishers; re-signing them would replace that.
it("tells signed Windows binaries from unsigned ones by their certificate table", () => {
  expect(hasAuthenticodeSignature(image(0x20b, 0x2a10))).toBe(true);
  expect(hasAuthenticodeSignature(image(0x20b, 0))).toBe(false);
  expect(hasAuthenticodeSignature(image(0x10b, 0x2a10))).toBe(true);
  expect(hasAuthenticodeSignature(image(0x10b, 0))).toBe(false);
});

it("does not take other files for Windows binaries", () => {
  expect(hasAuthenticodeSignature(Buffer.from("\x7fELF\x02\x01\x01", "latin1"))).toBeNull();
  expect(hasAuthenticodeSignature(Buffer.alloc(0))).toBeNull();
  const truncated = image(0x20b, 0x2a10).subarray(0, 0x90);
  expect(hasAuthenticodeSignature(truncated)).toBeNull();
});
