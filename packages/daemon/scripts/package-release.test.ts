import { join } from "node:path";
import { expect, it } from "vitest";
import { nodeLayout, resolveTarget, tarCommand } from "./package-release.ts";

const linux = { platform: "linux", arch: "x64" };
const mac = { platform: "darwin", arch: "arm64" };
const windows = { platform: "win32", arch: "x64" };

it("packages the host runtime when no target is named", () => {
  expect(resolveTarget(undefined, linux)).toBe("linux-x64");
  expect(resolveTarget(undefined, mac)).toBe("darwin-arm64");
  expect(resolveTarget(undefined, windows)).toBe("win32-x64");
});

it("fills in the host architecture for a bare platform", () => {
  expect(resolveTarget("darwin", mac)).toBe("darwin-arm64");
  expect(resolveTarget("darwin", { platform: "darwin", arch: "x64" })).toBe("darwin-x64");
});

it("keeps the Linux release pinned to x64 regardless of the host architecture", () => {
  expect(resolveTarget("linux-x64", linux)).toBe("linux-x64");
  expect(() => resolveTarget("linux-x64", { platform: "linux", arch: "arm64" })).toThrow(
    /Build the linux-x64 release on linux-x64/,
  );
});

// The bundled native terminal module is the host's prebuild, so a mismatch would produce an
// archive that only fails once someone runs it on the machine it was supposedly built for.
it("refuses to cross-compile", () => {
  expect(() => resolveTarget("darwin-arm64", linux)).toThrow(/Build the darwin-arm64 release/);
  expect(() => resolveTarget("linux-x64", mac)).toThrow(/Build the linux-x64 release/);
});

it("names the platforms it can package", () => {
  expect(() => resolveTarget("freebsd-x64", { platform: "freebsd", arch: "x64" })).toThrow(
    /No packaged runtime for freebsd-x64.*linux-x64, darwin-arm64, darwin-x64, win32-x64/,
  );
});

// Node's Windows zip is flat; reading the Unix layout from it finds neither Node nor npm.
it("finds Node and npm where each official archive keeps them", () => {
  expect(nodeLayout("linux-x64")).toEqual({
    node: join("bin", "node"),
    npm: join("lib", "node_modules", "npm"),
  });
  expect(nodeLayout("win32-x64")).toEqual({ node: "node.exe", npm: join("node_modules", "npm") });
});

// Git's GNU tar, often first on PATH on Windows, reads `C:\...` as a remote host and cannot read
// a zip; the system's bsdtar can.
it("extracts with Windows' own tar on Windows", () => {
  expect(tarCommand("win32", { SystemRoot: "D:\\Windows" })).toBe("D:\\Windows\\System32\\tar.exe");
  expect(tarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  expect(tarCommand("linux", { SystemRoot: "D:\\Windows" })).toBe("tar");
});
