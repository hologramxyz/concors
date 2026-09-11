import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs", "app-config.test.ts"],
    environment: "node",
  },
});
