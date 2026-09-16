import { Redirect } from "expo-router";

/**
 * Android delivers the GitHub sign-in redirect as a deep link as well as to the authentication
 * session that is waiting for it. The session handles the result; this route only prevents an
 * "unmatched route" screen and returns to the start, which forwards a signed-in person onwards.
 */
export default function NativeAuthCallback() {
  return <Redirect href="/" />;
}
