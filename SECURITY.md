# Security policy

Concors will eventually spawn processes, read and write files, and run Git commands on behalf of
users — locally and on their servers. We take reports about it seriously.

## Supported versions

Concors is pre-release. Only the `main` branch is supported; there are no maintained release lines
yet.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Report privately through
[GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository. Include:

- a description of the issue and its impact
- steps to reproduce or a proof of concept
- the affected component (`apps/desktop`, `packages/daemon`, `packages/protocol`, …)

You should receive an acknowledgement within 72 hours. We will keep you informed as we investigate
and will credit you in the fix unless you prefer otherwise.

## Scope notes for this stage of the project

- The daemon binds to `127.0.0.1` by default and has **no authentication yet**. Exposing it on a
  public interface is not supported and is not a vulnerability in itself; VPS authentication is
  planned before remote use is documented as supported.
- The desktop frontend receives only public `VITE_*` configuration. Anything found in the bundle is
  intentionally public.
- Tauri capabilities are kept to `core:default` plus the app's own commands. Reports about
  over-broad capabilities or CSP are welcome.
