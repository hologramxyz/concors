// Internal previews remain buildable; store builds require an explicit release audit.
if (process.env.EAS_BUILD_PROFILE === "production") await import("./release-check.mjs");
