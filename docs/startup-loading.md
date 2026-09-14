# Opening the desktop client

The browser preview and packaged desktop app show the Concors mark with a quiet shimmer from
first paint. The same React screen stays mounted while the account session is checked, the
saved machine is restored, and that machine sends its first workspace snapshot. There are no
intermediate “Restoring your session” or “Connect to your workspace” pages, and no minimum
loading delay once the workspace is ready. Native window controls remain available.

Machine restoration finishes before the first daemon connection starts. A saved cloud machine
therefore opens directly without briefly showing or connecting to This computer. A removed or
unavailable saved machine still falls back to This computer. Existing workspaces remain mounted
while their connection retries; a later machine switch uses the same quiet indicator inside the
workspace area. Direct settings links do not require a successful workspace connection.

After twelve seconds the splash offers Retry, plus Connection settings once signed in. This
keeps an unavailable machine or stalled request recoverable. Invalid/expired sessions still lead
to the sign-in form, and authentication errors retain their existing recovery UI.

A small same-origin script applies the stored light/dark preference before the application
bundle loads. The last applied theme's background and foreground are cached locally for the
next first paint, validated against the selected theme and mode, and restricted to hex colors.
Missing or inaccessible storage falls back to the system appearance. The script is an external
asset compatible with the native `script-src 'self'` policy. Reduced-motion preferences disable
the shimmer animation.

`e2e/startup.spec.ts` holds authentication, machine discovery, and the first snapshot separately;
it checks one persistent splash, first paint before React downloads, theme restoration, slow
connection recovery, removed-machine fallback, settings links, and reconnect continuity.
