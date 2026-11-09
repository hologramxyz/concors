# iPhone marketing screenshots — November 9, 2026

The Apple draft now selects four marketing creatives with real native app screens, large
benefit-led headlines, Concors branding, and coordinated paper/ink backgrounds. All four are
**1206 × 2622 RGB PNGs without alpha**, processed and **ACTIVE** in
`IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE`, in the order below.

| Order | Creative                                                 | Apple image                            | Apple placement                        |
| ----- | -------------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| 1     | [01-agents.png](marketing/exports/01-agents.png)         | `58800019-65ca-8a60-8025-6e9e15bc7856` | `7d800019-65ca-8a60-8f35-7560d0dec7ab` |
| 2     | [02-approvals.png](marketing/exports/02-approvals.png)   | `2ec00019-65ca-8a60-801b-7b3965725686` | `01c00019-65ca-8a60-8f37-9e716e59bf16` |
| 3     | [03-workspaces.png](marketing/exports/03-workspaces.png) | `de000019-65ca-8a60-8012-0d110792ae74` | `ab000019-65ca-8a60-8f02-ce98b78bc44d` |
| 4     | [04-terminal.png](marketing/exports/04-terminal.png)     | `ec400019-65ca-8a60-8030-72a17a5b3d5a` | `52c00019-65ca-8a60-8f35-bd226e9a6b43` |

[Campaign overview](marketing/exports/campaign-overview.png) ·
[Editable source, artwork prompt and reproduction](marketing/README.md) ·
[Apple readback](marketing/apple-staging.json)

The native screens come from the dedicated preview simulator build
`48deec50-2b7b-4067-9c9f-ea6900a9feec`, source `37a40ca8e3958c666e1f0f1856a6cb17f98fc08c`.
The simulator is **iPhone 17 Pro / iOS 26.5**. Only demo fixture sources differ from the mobile UI
in TestFlight **0.1.0 (16)**. No app controls or features are painted into the captures.

[The main native capture run](https://github.com/hologramxyz/concors/actions/runs/42647446212)
passed for agent progress, the approval request and the workspace sheet.
[The terminal recapture](https://github.com/hologramxyz/concors/actions/runs/42652795940)
also passed, dismissing iOS's first-use keyboard tutorial before retaining the image.
[Source hashes and provenance](marketing/capture-evidence.json) identify each selected PNG.
The projects and terminal output are fictional sample data; live customer content is absent.

Background artwork was made with the built-in image-generation tool; the real screens and copy
are composed separately in HTML/CSS for accuracy and reproducibility. The Concors mark and Geist
font reuse existing brand assets, with the font license retained.

Apple readback at **2026-11-09T16:31:22.080Z** confirms the display order and the same attached build
**16**. The original plain medium screenshot was removed from placement while its library image
was preserved. The older large-display Tabs image remains unplaced.

The review draft is still **READY_FOR_REVIEW**, with `submittedDate: null`.
These asset changes do not submit the app or verify the remaining real Apple user consent/token
exchange. The functional sign-in record remains separate in
[the live provider check](ios-apple-auth-live-browser.json).
