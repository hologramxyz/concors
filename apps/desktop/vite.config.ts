import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Set by `tauri dev` when developing against a physical mobile device; unused on desktop.
const host = process.env["TAURI_DEV_HOST"];

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Tauri expects a fixed port and fails if it is taken.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    ...(host ? { hmr: { protocol: "ws", host, port: 1421 } } : {}),
    watch: {
      // The Rust side is rebuilt by `tauri dev`; Vite must not react to it.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Only VITE_* variables are exposed to the frontend. Never put secrets in them.
  envPrefix: ["VITE_"],

  build: {
    target: "es2023",
    sourcemap: true,
  },

  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
