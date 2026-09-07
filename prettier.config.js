import config from "@concors/config/prettier";

export default {
  ...config,
  tailwindStylesheet: "./apps/desktop/src/styles.css",
  tailwindFunctions: ["cn", "cva"],
};
