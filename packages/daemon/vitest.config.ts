import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The same reason, for a whole test: several start real shells, PTYs and fixture agents, and
    // a Windows runner has taken just over the default five seconds for them. Windows gets three
    // times longer: its runners wait for the disk on every SQLite commit, and tests that save a
    // hundred events or replay a chat have run 20 to 40 seconds there and under 2 elsewhere.
    testTimeout: process.platform === "win32" ? 60_000 : 20_000,
    expect: {
      // Most daemon tests wait on real processes: a shell, Node, a fixture agent finishing its turn.
      // expect.poll gives up after one second by default, which a slow CI runner does not always
      // meet; two tests failed a release that way. Waits that need longer still say so.
      poll: { timeout: 10_000 },
    },
  },
});
