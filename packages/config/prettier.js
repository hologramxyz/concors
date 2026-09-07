import * as tailwindcss from "prettier-plugin-tailwindcss";

/** @type {import("prettier").Config} */
const config = {
  // Sorts Tailwind classes. `tailwindStylesheet` must be set by the consuming repo's config.
  plugins: [tailwindcss],
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
  overrides: [
    {
      files: ["*.md"],
      options: {
        proseWrap: "preserve",
      },
    },
  ],
};

export default config;
