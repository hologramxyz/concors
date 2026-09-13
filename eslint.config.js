import { base, nodeGlobals, tests } from "@concors/config/eslint/base";
import { react } from "@concors/config/eslint/react";

/**
 * Root ESLint flat config for the whole monorepo.
 *
 * Besides code-quality rules, this file encodes the architectural boundaries of Concors:
 *
 *  - Clients (desktop, future mobile) may only talk to the daemon through `@concors/protocol`
 *    and `@concors/daemon-client`, and to the control plane through `@concors/api-client`. They
 *    must never import daemon implementation details.
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
      "**/src-tauri/resources/local-daemon/**",
      "pnpm-lock.yaml",
      "apps/mobile/.expo/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "apps/mobile/assets/terminal-html.ts",
      "apps/mobile/assets/workspace-html.ts",
      "**/test-results/**",
      "**/playwright-report/**",
    ],
  },

  ...base,
  tests,

  // Node.js packages
  {
    files: [
      "packages/daemon/**/*.ts",
      "apps/desktop/scripts/**/*.ts",
      "packages/config/**/*.js",
      "*.js",
      "*.ts",
    ],
    ...nodeGlobals,
  },

  // Desktop app (React + Vite)
  ...react.map((cfg) => ({ ...cfg, files: ["apps/desktop/src/**/*.{ts,tsx}"] })),
  ...react.map((cfg) => ({
    ...cfg,
    files: [
      "apps/mobile/app/**/*.{ts,tsx}",
      "apps/mobile/src/**/*.{ts,tsx}",
      "apps/mobile/scripts/terminal-document.js",
    ],
  })),
  {
    files: ["apps/mobile/**/*.{ts,tsx,mts}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: [
      "apps/mobile/scripts/*.{mjs,mts}",
      "apps/mobile/app.config.ts",
      "apps/mobile/vitest.config.ts",
    ],
    ...nodeGlobals,
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-require-imports": ["error", { allow: ["\\.png$"] }] },
  },

  // shadcn/ui primitives are generated code owned by the CLI: they export `*Variants` helpers next
  // to components, which Fast Refresh tolerates but the lint rule flags.
  {
    files: ["apps/desktop/src/components/ui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },

  // Boundary: clients must not import daemon internals.
  {
    files: [
      "apps/**/*.{ts,tsx,mts}",
      "packages/api-client/**/*.ts",
      "packages/daemon-client/**/*.ts",
      "packages/protocol/**/*.ts",
    ],
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
