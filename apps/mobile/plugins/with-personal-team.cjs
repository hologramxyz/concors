/* global require, module */
// Expo loads local config plugins through CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withEntitlementsPlist, withInfoPlist } = require("expo/config-plugins");

/** Also remove stale capabilities when prebuilding over an earlier generated iOS project. */
module.exports = function withPersonalTeam(config) {
  config = withEntitlementsPlist(config, (mod) => {
    delete mod.modResults["aps-environment"];
    delete mod.modResults["com.apple.developer.associated-domains"];
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    if (Array.isArray(mod.modResults.UIBackgroundModes)) {
      mod.modResults.UIBackgroundModes = mod.modResults.UIBackgroundModes.filter(
        (mode) => mode !== "remote-notification",
      );
      if (!mod.modResults.UIBackgroundModes.length) delete mod.modResults.UIBackgroundModes;
    }
    return mod;
  });
};
