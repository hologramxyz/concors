# Agent account connections

Desktop agent panes check the selected provider's account as soon as they open. A
prompt above the composer offers sign-in when no account is configured. Dismissal
is remembered for that machine and provider in browser session storage; a small
**Connect account** button reopens it. Neither the check nor dismissal disables
sending prompts. Existing environment credentials and configurations remain usable.

- **Codex / ChatGPT:** `account/read`, followed by `account/login/start` with
  `chatgptDeviceCode`. The panel displays OpenAI's link and one-time code and observes
  the completion notification. Some accounts need device-code login enabled in
  ChatGPT security settings.
- **Claude Code:** `claude auth status --json` and `claude auth login`. The panel
  displays the CLI's browser link and accepts the authorization code through the
  CLI's stdin. Both Claude subscriptions and Anthropic Console login are offered.
- **OpenCode:** provider discovery, OAuth authorize/callback, or the native auth API
  for API keys. Headless OAuth is preferred over localhost browser callbacks when
  offered. Free/local models do not count as an authenticated account. Plugin
  methods that require additional questionnaires are not offered in this initial
  UI; existing CLI-configured providers still work.

Provider CLIs save and refresh their own credentials on the selected machine under
the daemon's OS user. This is machine account state shared by its agents, separate
from the Concors login. OpenCode credential inspection returns only provider IDs;
credential contents never enter responses. Login challenges and submitted codes/keys
use transient `agent.request` account operations and are excluded from conversation
items, SQLite request receipts, broadcasts, and browser storage. Pending flows belong
to the initiating WebSocket and expire after ten minutes. Cancel, dismissal, socket
closure, or daemon shutdown closes the associated sign-in processes. Failed checks
show a retry action and leave the composer usable.

The UI requires the daemon's `agent-accounts` capability. After merging, release and
install the updated daemon on managed machines as well as deploying the desktop
client; daemon 0.2.0 does not expose these account operations. No control-plane changes
or database migrations are needed.

Validation covers mocked native provider exchanges, private WebSocket exchanges,
receipt exclusion, cancellation/expiry, and browser acceptance for all three providers.
Browser tests simulate provider approval; completing a real provider login remains a
manual acceptance step by the account holder.

References: [Codex app server](https://learn.chatgpt.com/docs/app-server),
[Claude authentication](https://code.claude.com/docs/en/authentication),
[OpenCode server](https://opencode.ai/docs/server/).
