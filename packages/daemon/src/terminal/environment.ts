/** A user's interactive PTY must not inherit log/CI color suppression from its daemon launcher. */
export function terminalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(source).filter(
      ([key]) =>
        !["NO_COLOR", "FORCE_COLOR", "CLICOLOR", "CLICOLOR_FORCE"].includes(key.toUpperCase()),
    ),
  );
  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    CLICOLOR: "1",
    TERM_PROGRAM: "concors",
  };
}
