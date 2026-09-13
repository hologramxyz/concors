import { execFileSync } from "node:child_process";

/** Public build identity only. Never include paths, branch names, environment dumps or credentials. */
export function sourceRevision({
  readGit = (args) =>
    execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
  easCommit = process.env.EAS_BUILD_GIT_COMMIT_HASH,
} = {}) {
  const valid = (value) => typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
  try {
    const revision = readGit(["rev-parse", "HEAD"]);
    const dirty = readGit(["status", "--porcelain", "--untracked-files=no"]);
    if (valid(revision)) return revision + (dirty ? "-dirty" : "");
  } catch {
    // EAS archives can omit .git. Preserve its explicit commit instead of guessing.
  }
  return valid(easCommit) ? easCommit : "unknown";
}
