/* global require, __dirname, process, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads this CommonJS configuration. */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// SDK 57's development env module watches .env files independently of the CLI's
// EXPO_NO_DOTENV switch. Honor that switch in Metro too, so demo/test/local-device
// commands cannot silently inherit a saved TestFlight backend or demo flag.
if (process.env.EXPO_NO_DOTENV === "1") {
  const existing = config.resolver.blockList ?? [];
  config.resolver.blockList = [
    ...(Array.isArray(existing) ? existing : [existing]),
    /[/\\]\.env(?:\.[^/\\]+)?$/,
  ];
}

module.exports = config;
