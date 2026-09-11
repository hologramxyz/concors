# Third-party source notices

The following source files were imported from `getpaseo/paseo` revision
`a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6`, under Apache-2.0. The copyright
notice and full license are retained in `third-party/paseo-LICENSE`.

| Upstream source                                             | Concors destination under `apps/desktop/src/agents/paseo` |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `packages/protocol/src/agent-types.ts`                      | `agent-types.ts` (tool detail types extracted)            |
| `packages/protocol/src/tool-call-display.ts`                | `tool-call-display.ts`                                    |
| `packages/protocol/src/path-utils.ts`                       | `path-utils.ts`                                           |
| `packages/protocol/src/tool-name-normalization.ts`          | `tool-name-normalization.ts`                              |
| `packages/app/src/utils/tool-call-detail-state.ts`          | `tool-call-detail-state.ts`                               |
| `packages/app/src/utils/extract-tool-call-file-path.ts`     | `extract-tool-call-file-path.ts`                          |
| `packages/app/src/composer/submit.ts`                       | `submit.ts`                                               |
| `packages/app/src/composer/agent-controls/model-loading.ts` | `model-loading.ts`                                        |

Changes adapt imports, strict optional/indexed types, array syntax, and the English
send-error fallback. The tool icon type is narrowed to the needs of the DOM adapter.
`timeline-item.tsx` and `composer.tsx` connect these helpers to React DOM and Concors'
daemon protocol; Paseo's React Native components cannot be mounted directly here.
Daemon mode presets also follow Paseo's `codex-app-server-agent.ts`.

Additional imports: `components/icons/codex-icon.tsx`,
`components/context-window-meter.utils.ts`, `utils/tool-call-icon-name.ts`, and
`utils/highlight-cache.ts`. DOM adapters replace React Native SVG/clipboard/style
APIs, and the cache constructor uses erasable TypeScript syntax. Syntax highlighting
uses the published `@getpaseo/highlight@0.7.2` package; its packaged third-party
parser licenses remain with the dependency.

## Terminal primitives

Paseo commit `a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6` informed the PTY/headless-xterm architecture,
serialized attach snapshots and explicit resize claim/update contract. The output coalescer and
Windows npm CLI shim escaping are adapted from its terminal implementation; attribution is in the
source and the full Apache-2.0 license is preserved in `third-party/paseo-LICENSE`.
