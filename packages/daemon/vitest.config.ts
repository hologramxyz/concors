import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    expect: {
      // Most daemon tests wait on real processes: a shell, Node, a fixture agent finishing its turn.
      // expect.poll gives up after one second by default, which a slow CI runner does not always
      // meet; two tests failed a release that way. Waits that need longer still say so.
      poll: { timeout: 10_000 },
    },
  },
});
