import { win32 } from "node:path";
import { resolveProfile } from "../profiles.ts";

/**
 * Whether a new terminal here opens PowerShell, so tests that type into one know its syntax. On
 * Windows it does unless neither PowerShell can be found, and then cmd.exe opens instead.
 */
export function defaultShellIsPowerShell(env: NodeJS.ProcessEnv = process.env): boolean {
  const { command } = resolveProfile("shell", process.platform, env);
  return /^(?:pwsh|powershell)\.exe$/i.test(win32.basename(command));
}
