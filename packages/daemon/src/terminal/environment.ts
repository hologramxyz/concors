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

/**
 * `env` with its PATH replaced. Windows spells the variable `Path`, and a spread of `process.env`
 * keeps that key, so setting `PATH` beside it leaves two. Node's spawn keeps one of them, but
 * node-pty hands both to ConPTY, where the original `Path` can win and a terminal loses the
 * provider CLIs and the bundled node/npm put in front of it. Variable names are case-sensitive
 * elsewhere, so only Windows drops the other spellings.
 */
export function withPath(
  env: NodeJS.ProcessEnv,
  value: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const result =
    platform === "win32"
      ? Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH"))
      : { ...env };
  result["PATH"] = value;
  return result;
}
