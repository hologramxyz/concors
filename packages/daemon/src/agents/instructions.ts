/**
 * Standing guidance Concors gives every agent it starts, about the one thing agents cannot work
 * out from the repository: the person reads the chat in the Concors app, usually on another
 * computer, and only some links survive that trip. It deliberately says nothing about how to
 * code; that belongs to the provider and the project's own instructions.
 *
 * The app rewrites `localhost` links to the machine's authenticated preview address, and the
 * gateway and preview discovery both reach dev servers on 127.0.0.1, hence the binding advice.
 * Background tasks of the agent's CLI stop with it, and the daemon stops idle CLIs (a closed tab,
 * a CLI update), so dev servers are started detached; the person stops them from Previews,
 * which lists each by the name the agent put in its environment (see host/preview-names.ts).
 * Images the agent embeds by path are copied when its message completes (see images.ts), within
 * the limits stated here.
 *
 * Detaching is the one part that depends on the system: `setsid nohup` and `/tmp` do not exist on
 * Windows, where PowerShell's Start-Process starts a process that outlives the shell that started
 * it. Agents there run commands in PowerShell (Codex) or Git Bash (Claude Code), and from bash the
 * same line runs through `powershell -Command`.
 */
export function agentInstructions(platform: NodeJS.Platform): string {
  const detached =
    platform === "win32"
      ? `from PowerShell, \`$env:CONCORS_PREVIEW_NAME = "Landing site"; Start-Process pnpm -ArgumentList "dev --host 127.0.0.1" -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\\dev-5173.log" -RedirectStandardError "$env:TEMP\\dev-5173.err.log"\``
      : `\`CONCORS_PREVIEW_NAME="Landing site" setsid nohup pnpm dev --host 127.0.0.1 > /tmp/dev-5173.log 2>&1 < /dev/null &\``;
  return `You are running inside Concors. The person you work with reads your replies in the Concors app, often on a different computer from the one you run on.

- To show them a running web app, start its dev server listening on 127.0.0.1 (for example \`--host 127.0.0.1\`) as a detached process named with \`CONCORS_PREVIEW_NAME\`, such as ${detached}, and link its local address, such as [the preview](http://localhost:5173/pricing). Concors lists running previews by that name, so make it a few words saying what the app is. Do not run it as your own background task: those stop when your session does, and the preview should keep running until they stop it from Concors. Concors turns localhost links into an address that opens in their browser, so do not set up tunnels or public URLs for this.
- To show them an image, such as a screenshot of your work, embed it in your reply with Markdown image syntax and its path on this machine: ![Pricing page on desktop](/tmp/pricing-desktop.png). Concors shows it inline in the chat. Use PNG, JPEG, WebP or GIF under 1 MB each (prefer JPEG or a smaller viewport for large screenshots), and at most 8 images per reply.
- File links only open for files inside the current project. Mention other paths as plain text instead of linking them.`;
}

export const AGENT_INSTRUCTIONS = agentInstructions(process.platform);
