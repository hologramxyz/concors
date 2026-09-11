import { checkRelease } from "./release-check.mjs";

// Only the explicitly named candidate profile separates binary QA from submission.
// It still requires production identity/configuration and cannot enable demo/private access.
const profile = process.env.EAS_BUILD_PROFILE;
if (profile === "candidate") await checkRelease({ candidate: true });
else if (profile === "production" || process.env.APP_VARIANT === "production") await checkRelease();
