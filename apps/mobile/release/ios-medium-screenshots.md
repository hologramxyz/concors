# Required iPhone medium-display screenshot — November 8, 2026

Apple's current [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
require an iPhone Dynamic Island medium-display image. A fresh capture is processed and active in
the iOS 0.1.0 draft; the existing large-display image is preserved.

| Field             | Verified value                                                                          |
| ----------------- | --------------------------------------------------------------------------------------- |
| Simulator / image | iPhone 17 Pro, iOS 26.5; 1206 × 2622 RGB PNG, no alpha                                  |
| Simulator build   | `3f59c019-6282-4af3-9a29-e5f25c9612a2`                                                  |
| Runtime source    | `2f74591466bd3ef2e5d0dbd715f38c6d5becfe0e`                                              |
| Native run        | [42435376101 — passed](https://github.com/hologramxyz/concors/actions/runs/42435376101) |
| Workflow PR       | [193 — merged; 19 CI checks passed](https://github.com/hologramxyz/concors/pull/193)    |
| Image             | [Workspace selector](store-assets/en-US/iphone-medium/store-workspaces.png)             |
| Apple group       | `IPHONE_DYNAMIC_ISLAND_MEDIUM_PROFILE`                                                  |
| Image / state     | `37c00019-65ca-8a60-8010-fd41749b7524` / `PREPARE_FOR_SUBMISSION` (processed)           |
| Placement / state | `20800019-65ca-8a60-8f32-458f81ef3a0e` / `ACTIVE`                                       |
| Readback          | `2026-11-08T02:00:18.584Z`                                                              |
| Original SHA-256  | `21bcdea9196bfd954ff4b99e413273dc81086102253d8fab1406755a2256a593`                      |
| Uploaded SHA-256  | `720c9aa22ff402151cec6ad0fdc2815d974e8cce1276dbce4891d64744d509ca`                      |

The image was visually inspected and re-encoded without changing any decoded RGB pixel. It was
not resized, reconstructed or composited. It shows the real native interface with fictional data.
The agent and files captures were not selected: one concerns preparing a test client, and the
other explicitly shows the demo's missing filesystem.

The new simulator build includes TestFlight 16's UI dependency and current runtime sources, using
the fixture-enabled preview identity solely for capture. It is not a submission binary. The native
control/composer flow passed, including the presented model picker and draft/navigation checks.
Physical-device results are separate in [the device report](ios-build-16-device-acceptance.md).
