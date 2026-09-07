import { base, nodeGlobals, tests } from "@concors/config/eslint/base";
import { react } from "@concors/config/eslint/react";

/**
 * Root ESLint flat config for the whole monorepo.
 *
 * Besides code-quality rules, this file encodes the architectural boundaries of Concors:
 *
 *  - Clients (desktop, future mobile) may only talk to the daemon through `@concors/protocol`
 *    and `@concors/daemon-client`. They must never import daemon implementation details.
 *  - Tauri APIs are confined to `apps/desktop/src/tauri/` so that the rest of the UI stays
 *    portable to non-Tauri hosts (web, mobile).
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/src-tauri/target/**",
      "**/src-tauri/gen/**",
      "pnpm-lock.yaml",
    ],
  },

  ...base,
  tests,

  // Node.js packages
  {
    files: ["packages/daemon/**/*.ts", "packages/config/**/*.js", "*.js", "*.ts"],
    ...nodeGlobals,
  },

  // Desktop app (React + Vite)
  ...react.map((cfg) => ({ ...cfg, files: ["apps/desktop/src/**/*.{ts,tsx}"] })),

  // Boundary: clients must not import daemon internals.
  {
    files: ["apps/**/*.{ts,tsx}", "packages/daemon-client/**/*.ts", "packages/protocol/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@concors/daemon", "@concors/daemon/*", "**/packages/daemon/**"],
              message:
                "Clients must talk to the daemon only through @concors/protocol / @concors/daemon-client. The daemon is a replaceable process, not a library.",
            },
          ],
        },
      ],
    },
  },

  // Boundary: Tauri APIs stay inside apps/desktop/src/tauri/.
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}"],
    ignores: ["apps/desktop/src/tauri/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@concors/daemon", "@concors/daemon/*", "**/packages/daemon/**"],
              message:
                "Clients must talk to the daemon only through @concors/protocol / @concors/daemon-client.",
            },
            {
              group: ["@tauri-apps/*"],
              message:
                "Import Tauri APIs only inside apps/desktop/src/tauri/ so the rest of the UI stays host-agnostic.",
            },
          ],
        },
      ],
    },
  },
];
