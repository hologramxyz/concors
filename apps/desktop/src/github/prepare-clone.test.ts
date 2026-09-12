import { describe, expect, it, vi } from "vitest";
import { githubRepository, prepareClone } from "./prepare-clone";
const status = {
  configured: true,
  connected: true,
  login: "alice",
  updatedAt: null,
  manageUrl: null,
};
const api = () => ({
  githubStatus: vi.fn().mockResolvedValue(status),
  prepareGitHubMachine: vi.fn().mockResolvedValue({ ready: true }),
});
describe("GitHub clone preparation", () => {
  it.each([
    "https://github.com/alice/project.git",
    "git@github.com:alice/project.git",
    "ssh://git@github.com/alice/project",
    " https://github.com/alice/project/ ",
  ])("prepares the selected VPS and uses credential-helper HTTPS for %s", async (url) => {
    const client = api();
    expect(await prepareClone(client, "machine-2", url)).toBe(
      "https://github.com/alice/project.git",
    );
    expect(client.prepareGitHubMachine).toHaveBeenCalledWith("machine-2", "alice/project");
  });
  it("uses the same account connection on two different VPSs", async () => {
    const client = api();
    await prepareClone(client, "first", "https://github.com/alice/project.git");
    await prepareClone(client, "second", "https://github.com/alice/project.git");
    expect(client.prepareGitHubMachine.mock.calls.map(([machine]) => machine)).toEqual([
      "first",
      "second",
    ]);
  });
  it("preserves local Git credentials and third-party repository URLs", async () => {
    const client = api();
    expect(await prepareClone(client, "local", "git@github.com:alice/project.git")).toBe(
      "git@github.com:alice/project.git",
    );
    expect(await prepareClone(client, "vps", "https://gitlab.com/alice/project.git")).toBe(
      "https://gitlab.com/alice/project.git",
    );
    expect(client.githubStatus).not.toHaveBeenCalled();
  });
  it("allows a public URL without connecting GitHub", async () => {
    const client = api();
    client.githubStatus.mockResolvedValue({ ...status, connected: false });
    expect(await prepareClone(client, "vps", "https://github.com/alice/public.git")).toBe(
      "https://github.com/alice/public.git",
    );
    expect(client.prepareGitHubMachine).not.toHaveBeenCalled();
  });
  it("surfaces permission or VPS preparation failures before starting clone", async () => {
    const client = api();
    client.prepareGitHubMachine.mockRejectedValue(new Error("Your running VPS was not found."));
    await expect(
      prepareClone(client, "other", "https://github.com/alice/project.git"),
    ).rejects.toThrow("Your running VPS");
  });
  it.each([
    "https://evil.example/alice/project",
    "https://github.com.evil.example/alice/project",
    "https://token@github.com/alice/project",
    "https://github.com/alice/../project",
    "https://github.com/alice/project?token=secret",
    "https://github.com/alice/..",
  ])("rejects ambiguous GitHub URL %s", (url) => {
    expect(githubRepository(url)).toBeNull();
  });
});
