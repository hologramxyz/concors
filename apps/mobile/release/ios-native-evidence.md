# Native iPhone evidence — acceptance incomplete

Current update November 8: TestFlight **0.1.0 (16)** is the selected production candidate.
[The fresh medium-display capture and native control run](ios-medium-screenshots.md) passed;
[the reviewer workspace and AI](reviewer-ai-operations.md) are configured. Owner phone results are in
[the device report](ios-build-16-device-acceptance.md). The November 6 artifact details below are
historical and do not describe the current build, provider configuration or reviewer readiness.

## Screenshot already verified in Apple

The workspace capture was produced by the actual iPhone simulator app with fictional workspace
data, visually inspected, uploaded, and read back through Apple's asset-library and placement APIs.
It shows the native Tabs drawer with agent and terminal choices. It contains no customer data.
The exact [uploaded PNG](store-assets/en-US/iphone-6.9/store-workspaces.png) is retained here for
review; the draft still needs its final screenshot selection.

| Field                      | Verified value                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| App / locale               | `6817622624` / `en-US`                                                         |
| App Store version state    | `PREPARE_FOR_SUBMISSION`                                                       |
| Simulator                  | iPhone 17 Pro Max, iOS 26.5, 1320 × 2868                                       |
| Expo simulator build       | `d3dae1ac-2cb5-479f-a54b-9c3fc6092018`                                         |
| Simulator source revision  | `9c348886123b34787a37efb1180394c2e8bc22f5`                                     |
| Source run                 | [42165547089](https://github.com/hologramxyz/concors/actions/runs/42165547089) |
| Original filename          | `store-workspaces.png`                                                         |
| Original SHA-256           | `1622340f6e1aed82feed156afadf72174ecf92b8e7904d98a980cd30f8d67fa8`             |
| Uploaded SHA-256           | `e46b0b6ccd1036a477afdb52953c86e27722536aadcb147bbc1693d02788ea45`             |
| Uploaded size              | 438,038 bytes                                                                  |
| Apple image ID             | `15400019-65ca-8a60-8017-ce4f138f9d47`                                         |
| Image state                | `PREPARE_FOR_SUBMISSION` (processed)                                           |
| Apple placement ID / state | `b0c00019-65ca-8a60-8f35-36d2b2c987e2` / `ACTIVE`                              |
| Placement group            | `IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE` (6.9-inch)                               |

The PNG encoding drops only the redundant, fully opaque alpha channel. Decoded RGB pixels before
and after conversion were compared byte for byte and are identical. No content was composited,
resized or replaced. This is a simulator capture, not a browser reconstruction.

The simulator artifact uses the preview bundle and fixture-enabled capture profile. Its app runtime
sources match build 12's production source; it is not the signed TestFlight binary and cannot prove
production authentication or remote workspace access. Do not submit this simulator artifact.

## Limits and remaining checks

The source run exceeded its UI-step budget after saving this image. A later
[run, 42171848363](https://github.com/hologramxyz/concors/actions/runs/42171848363), captured all three
views and typed into the native composer, but did not open the model picker. Its title assertion
matched the trigger's accessible label; a follow-up now requires an option inside the presented
picker.

The corrected [run, 42173390095](https://github.com/hologramxyz/concors/actions/runs/42173390095),
**passed** using workflow/test revision `2fdfd25c29f5e535f1689c2e244a023c96cb3410` against the
simulator artifact identified above: all **63** recorded commands completed.
The inspected artifacts verify native text input, a presented model picker, repeated provider
navigation, model selection, effort controls, draft preservation across sheet/file navigation, and
four header hit areas opening Tabs. This proves the fixture-based simulator flow; production auth,
remote workspace access and physical-device acceptance remain open.
The [native evidence artifact](https://github.com/hologramxyz/concors/actions/runs/42173390095/artifacts/13483225700)
contains the command results, screenshots and XCTest logs.

Visual review rejected that run's agent and file captures for the store: the agent view includes
demo guidance and the files view is an empty state. Neither was uploaded. Capture these features
from an appropriate isolated workspace once reviewer access is available. The existing workspace
image remains the sole uploaded image. A saved screenshot is not a passing interaction test.

The workflow preserves original simulator signing, normalizes the status bar, captures before later
assertions and retains XCTest diagnostics. See [the runbook](../../../docs/mobile-release.md#native-iphone-store-captures).

Additional physical-device edge cases are not separately claimed as tested. Actual Apple-account
sign-in and OAuth-token return remain unverified; see the current
[submission packet](submission-packet.md). The earlier November 6 Apple-disabled/no-reviewer state
has been superseded by the activation and reviewer-access records linked there.
