import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { rpcSessions } from "./rpc-sessions.ts";

it("reads beyond 100 native transcripts, normalizes directories, and deduplicates managed paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "concors-rpc-list-"));
  const sessions = join(directory, "sessions");
  await mkdir(sessions);
  try {
    for (let index = 0; index < 105; index++)
      await writeFile(
        join(sessions, `${String(index).padStart(3, "0")}.jsonl`),
        [
          JSON.stringify({ type: "session", cwd: directory + "/." }),
          JSON.stringify({
            type: "message",
            message: { role: "user", content: `Saved prompt ${index}` },
          }),
        ].join("\n"),
      );
    await writeFile(
      join(sessions, "foreign.jsonl"),
      JSON.stringify({ type: "session", cwd: join(directory, "other") }),
    );
    const rows = await rpcSessions(
      "pi",
      directory,
      sessions,
      { PI_CODING_AGENT_SESSION_DIR: sessions },
      106,
    );
    expect(rows).toHaveLength(105);
    expect(new Set(rows.map((row) => row.id)).size).toBe(105);
    expect(
      rows.every((row) => row.directory === directory && row.title.startsWith("Saved prompt")),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
