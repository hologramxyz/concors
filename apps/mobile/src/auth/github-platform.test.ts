import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { OS: "ios" },
  config: { scheme: "concors" as string | string[] | undefined },
  browser: vi.fn(),
  bytes: vi.fn(),
  digest: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("expo-constants", () => ({ default: { expoConfig: mocks.config } }));
vi.mock("expo-web-browser", () => ({ openAuthSessionAsync: mocks.browser }));
vi.mock("expo-crypto", () => ({
  getRandomBytes: mocks.bytes,
  digest: mocks.digest,
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));
import { nativeGitHubPlatform } from "./github-platform";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform.OS = "ios";
  mocks.config.scheme = "concors";
});

it.each(["ios", "android"])(
  "uses the %s authentication session with the registered callback",
  async (os) => {
    mocks.platform.OS = os;
    const platform = nativeGitHubPlatform();
    if (!platform) throw new Error("Missing native authentication adapter");
    expect(platform.scheme).toBe("concors");
    mocks.browser.mockResolvedValue({ type: "cancel" });
    await expect(
      platform.openAuthSession(
        "https://api.concors.dev/api/v1/native-auth/github/start",
        "concors://native-auth/callback",
      ),
    ).resolves.toEqual({ type: "cancel" });
    expect(mocks.browser).toHaveBeenCalledExactlyOnceWith(
      "https://api.concors.dev/api/v1/native-auth/github/start",
      "concors://native-auth/callback",
      { preferEphemeralSession: false },
    );
  },
);

it("uses native cryptographic randomness and SHA-256 for PKCE", async () => {
  const platform = nativeGitHubPlatform();
  if (!platform) throw new Error("Missing native authentication adapter");
  const bytes = new Uint8Array(32).fill(5);
  mocks.bytes.mockReturnValue(bytes);
  mocks.digest.mockResolvedValue(bytes.buffer);
  expect(platform.randomBytes(32)).toBe(bytes);
  expect(mocks.bytes).toHaveBeenCalledWith(32);
  expect(await platform.sha256("verifier")).toEqual(bytes);
  expect(mocks.digest).toHaveBeenCalledWith("SHA-256", new TextEncoder().encode("verifier"));
});

it("keeps preview callbacks isolated from the store identity", () => {
  mocks.config.scheme = ["concors-preview", "exp+concors"];
  expect(nativeGitHubPlatform()?.scheme).toBe("concors-preview");
});

it("does not offer a broken native callback on web or an unconfigured build", () => {
  mocks.platform.OS = "web";
  expect(nativeGitHubPlatform()).toBeNull();
  mocks.platform.OS = "ios";
  mocks.config.scheme = undefined;
  expect(nativeGitHubPlatform()).toBeNull();
});
