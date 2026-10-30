import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Set by `tauri dev` when developing against a physical mobile device; unused on desktop.
const host = process.env["TAURI_DEV_HOST"];

/**
 * With the dev proxy, the sign-in page would open on localhost:1420, an origin the identity
 * provider does not trust, so Google and GitHub refuse to start. The page is a top-level browser
 * visit that needs no same-origin access, so send it to the API's own origin instead.
 */
function redirectNativeSignInPage(apiOrigin: string): Plugin {
  return {
    name: "concors:redirect-native-sign-in",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/api/v1/native-auth/start")) return next();
        response.statusCode = 302;
        response.setHeader("Location", new URL(request.url, apiOrigin).toString());
        response.end();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  // Development only: forward `/api/*` to a real control-plane API so the browser talks to it
  // same-origin (session cookies work, no CORS). Not prefixed with VITE_, so it never reaches the
  // bundle; the packaged app calls VITE_CONCORS_API_URL directly with a bearer token instead.
  const apiProxyTarget = loadEnv(mode, root, "")["CONCORS_API_PROXY_TARGET"];

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(apiProxyTarget ? [redirectNativeSignInPage(apiProxyTarget)] : []),
    ],

    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },

    // Workspace schemas must stay live while the daemon/client protocol evolves.
    optimizeDeps: {
      exclude: ["@concors/protocol", "@concors/daemon-client", "@concors/api-client"],
      include: ["zod"],
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
      ...(apiProxyTarget
        ? {
            proxy: {
              "/api": {
                target: apiProxyTarget,
                changeOrigin: true,
                // Better Auth rejects state-changing requests from untrusted origins; the API's own
                // origin is always trusted, so present the proxied requests as coming from there.
                headers: { origin: apiProxyTarget },
              },
            },
          }
        : {}),
    },

    // Only VITE_* variables are exposed to the frontend. Never put secrets in them.
    envPrefix: ["VITE_"],

    build: {
      target: "es2023",
      sourcemap: true,
    },

    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    },
  };
});
