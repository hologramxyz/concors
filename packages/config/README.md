# @concors/config

Shared tooling configuration for the Concors monorepo. This package contains no runtime code.

| Export                         | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `@concors/config/eslint/base`  | Base ESLint flat config (TypeScript strict + Prettier compatibility) |
| `@concors/config/eslint/react` | Additional ESLint rules for React + Vite front-ends                  |
| `@concors/config/prettier`     | Prettier configuration                                               |

The root `eslint.config.js` and `prettier.config.js` consume these so that every package is linted and
formatted identically.

TypeScript settings live in the root [`tsconfig.base.json`](../../tsconfig.base.json); each package
extends it with a relative path and only adds its target-specific `lib`/`jsx`/`types` options.
