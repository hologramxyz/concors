import { expect, it } from "vitest";
import { sourceRevision } from "./source-revision.mjs";

const revision = "a".repeat(40);
it("stamps the actual checkout and marks uncommitted changes", () => {
  for (const dirty of ["", " M apps/mobile/app/index.tsx"])
    expect(
      sourceRevision({ readGit: (args) => (args[0] === "rev-parse" ? revision : dirty) }),
    ).toBe(revision + (dirty ? "-dirty" : ""));
});
it("uses the EAS commit only when checkout metadata is unavailable", () => {
  expect(
    sourceRevision({
      readGit: () => {
        throw new Error("no git");
      },
      easCommit: revision,
    }),
  ).toBe(revision);
});
it("never injects arbitrary metadata into the bundled HTML", () => {
  expect(
    sourceRevision({ readGit: () => "<script>bad</script>", easCommit: "secret-or-invalid" }),
  ).toBe("unknown");
});
