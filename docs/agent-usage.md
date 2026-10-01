# Context window and plan usage

The ring in the agent composer shows how full the conversation's context window is. Opening it
shows the figures and, below them, what is left of the provider's plan: the rolling windows
coding subscriptions are limited by, each as a bar with its share and a reset countdown
("42% · resets in 2h 14m"), plus the plan's name. Bars turn amber at 70% and red at 90%.

The two are separate on purpose. The context window belongs to one conversation and is pushed
with each turn (`AgentInfo.context`). Plan windows belong to the provider account that several
conversations share, so they are asked for only when someone opens the ring, and every session
of a provider configuration shares one answer (configurations can sign in to different accounts).

## Per provider

| Provider                        | Context window                                                                                                                                           | Plan windows                                                                                                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                     | Claude Code's own accounting (what `/context` shows), read when a session starts and at the end of each turn, with the streamed message usage in between | The Agent SDK's usage report: **Session** (five hours), **Weekly**, and a weekly window per model under the server's own name (for example **Weekly · Fable**). Legacy `seven_day_opus`/`seven_day_sonnet` keys are used only when the server does not name the same bucket |
| Codex                           | The app server's thread token usage and model context window                                                                                             | `account/rateLimits/read`: the primary and secondary windows, labelled by their reported length (a 5-hour window is **5-hour**, a 7-day one **Weekly**), and the plan type                                                                                                  |
| OpenCode, Pi, OMP               | Reported per turn; the model catalog's window fills the ring before the first turn ends                                                                  | Not reported                                                                                                                                                                                                                                                                |
| ACP presets (Gemini and others) | Reported only if the agent sends ACP usage updates                                                                                                       | Not reported                                                                                                                                                                                                                                                                |

Nothing reads a CLI's stored credentials or calls a private usage endpoint: plan windows come
from the provider's own session (Claude) or app server (Codex). Accounts without plan limits —
API keys, Bedrock, Vertex — say so instead of showing empty bars. A provider that reports neither
context nor plan usage shows no ring.

## Freshness

The machine caches a provider's plan windows for a minute, and clients reuse an account's answer
for as long, timed on their own clock. Answers about one session — still starting, not connected —
are asked again on the next look. The refresh button always asks again. A window whose reset
time has passed shows no figure, since the one it had belongs to the window that ended, and an
answer holding such a window is asked again on the next look rather than reused. Only a connected session can answer: opening a chat connects it,
while starting a provider just to read its usage would launch a CLI unasked. A failed refresh keeps
the last windows and shows why.

## Compatibility

Plan usage needs the daemon's `agent-plan-usage` capability; older daemons never receive the
request and the ring shows only the context window.

## Phone

On iPhone the composer's context button opens a native sheet with the same figures and bars as
the desktop popover: both are built from one `usageView`, so their wording cannot drift. The
button turns amber from 70% and red from 90%, like the ring. Opening the sheet asks for plan usage
and it follows the answer while open; its refresh button asks again. Android and the browser keep
the shared popover.
