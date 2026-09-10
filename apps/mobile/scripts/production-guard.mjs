// Internal previews remain buildable; store builds require an explicit release audit.
if (process.env.EAS_BUILD_PROFILE === "production" || process.env.APP_VARIANT === "production")
  await import("./release-check.mjs");
