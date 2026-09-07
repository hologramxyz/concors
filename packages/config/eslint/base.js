import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Base ESLint configuration shared by every package in the monorepo.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.es2023,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // Must be last so it can disable formatting rules that conflict with Prettier.
  prettier,
);

/**
 * Globals for packages that run on Node.js.
 *
 * @type {import("eslint").Linter.Config}
 */
export const nodeGlobals = {
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
};

/**
 * Relaxations for test files.
 *
 * @type {import("eslint").Linter.Config}
 */
export const tests = {
  files: ["**/*.test.ts", "**/*.test.tsx"],
  rules: {
    "@typescript-eslint/no-non-null-assertion": "off",
  },
};
