import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const source = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/tauri$/, replacement: source("mobile/native-platform.ts") },
      { find: "@/auth/api", replacement: source("mobile/api.ts") },
      { find: "@/tauri/open-external", replacement: source("mobile/external.ts") },
      { find: "@", replacement: source("") },
    ],
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: "es2022",
    outDir: "dist/mobile-ui",
    sourcemap: false,
    lib: {
      entry: source("mobile/main.tsx"),
      name: "ConcorsMobile",
      formats: ["iife"],
      fileName: () => "workspace.js",
      cssFileName: "workspace",
    },
    cssCodeSplit: false,
  },
});
