import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import type { SignInPlatform } from "./sign-in";

function buildScheme(): string | null {
  const scheme = Constants.expoConfig?.scheme;
  return (Array.isArray(scheme) ? scheme[0] : scheme) ?? null;
}

/**
 * The native pieces sign-in needs, or `null` where it cannot run: the web build has no
 * authentication session that returns to an app scheme.
 */
export function nativeSignInPlatform(): SignInPlatform | null {
  const scheme = buildScheme();
  if (Platform.OS === "web" || !scheme) return null;
  return {
    scheme,
    randomBytes: (count) => Crypto.getRandomBytes(count),
    sha256: async (input) =>
      new Uint8Array(
        await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(input)),
      ),
    // Non-ephemeral, so a GitHub or Google login already present in Safari or Chrome is reused.
    openAuthSession: (url, redirectUrl) =>
      WebBrowser.openAuthSessionAsync(url, redirectUrl, { preferEphemeralSession: false }),
  };
}
