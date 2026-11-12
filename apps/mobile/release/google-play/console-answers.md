# Play Console declaration packet

Prepared November 10 and updated November 12, 2026 for `xyz.hologram.concors`. Listing copy and six
images are uploaded, Data safety was accepted by the API, and build 3 is active on internal testing.
The remaining Console-only declarations below are prepared answers, not verified completed forms.
See [upload evidence](play-upload-2026-11-12.json).

| Field                 | Prepared answer                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| App                   | Concors: Agent Orchestrator; English (United States); app, free                                 |
| Category              | Productivity                                                                                    |
| Countries             | All available countries, subject to account verification and Console availability               |
| Website / support     | https://concors.dev / gm@hologram.xyz                                                           |
| Privacy policy        | https://concors.dev/privacy                                                                     |
| Account deletion      | https://concors.dev/account/delete; also Settings → Account → Delete account                    |
| Ads                   | No                                                                                              |
| Target audience       | 16–17 and 18+; the service minimum is 16                                                        |
| App access            | Some or all functionality restricted; supply the private reviewer login/instructions            |
| Account creation      | Email one-time code and configured OAuth providers; sign-in also creates an account             |
| Financial features    | No financial, lending, trading, crypto, banking or payment feature in this app                  |
| Health features       | No health, medical, fitness or Health Connect feature                                           |
| Government / news     | Not a government or news app                                                                    |
| In-app purchases      | None in the launch mobile app                                                                   |
| Sensitive permissions | No camera, microphone, contacts, location or broad media/storage access; optional notifications |

The signed-binary audit is the source of truth for permissions. Android attachments use system
pickers; dictation uses the user's Android keyboard. Do not declare microphone recording merely
because the keyboard offers its own voice input. No advertising identifier permission is present
in the audited candidate.

## Data safety and deletion

The [inventory](data-safety.md) and [submitted CSV](data-safety-draft.csv) include account-creation
methods, the account-deletion URL, third-party sign-in diagnostics and optional notification
tokens. Google accepted the updated CSV on November 12. Verify the displayed answers in Console;
the publishing API has no Data safety readback endpoint. Do not answer that no data is collected
or that workspace content is end-to-end encrypted. Separate partial-data deletion without account
deletion is answered No; full account deletion remains available.

Google requires both an in-app deletion route and an external route for apps that create accounts.
The public Concors route names the app, explains retained records and allows a deletion request.
See [Google's account-deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).

## Content rating and AI

Complete the actual IARC questionnaire in Console; the service minimum is not the content rating.
Concors operates private development workspaces. It has no public feed, dating, gambling,
advertising, payments, curated violent/sexual content or sale of digital goods. Users can submit
prompts, see generated text/code, attach selected files and access machines they control. Answer
the specific communication, content and internet-access questions against that behavior rather
than selecting “no” indiscriminately.

Treat AI generation conservatively as in scope. Prompts/content go to the agent's named provider
after the app's data-sharing consent. The existing in-app report route is Settings → Account →
Report content or a problem; reviewers should be able to reach it without leaving the
app. Provider safeguards and the terms prohibit abusive or malicious use. Do not promise that all
user-selected models are filtered identically. Google's policy requires prevention of prohibited
content and in-app reporting; a provider disclaimer alone does not establish compliance.
See [AI-generated content policy](https://support.google.com/googleplay/android-developer/answer/13985936)
and [scope and examples](https://support.google.com/googleplay/android-developer/answer/14094294).

## Reviewer and internal release

Enter the private email/test code in **App content → App access**, with the isolated machine and
AI instructions. Do not paste these into store descriptions or a public issue. The account does
not require a reviewer-owned inbox, social account, machine or paid AI subscription.
See [Google's review sign-in requirements](https://support.google.com/googleplay/android-developer/answer/15748846).

The audited production AAB **0.1.0 (3)** is uploaded and the internal track reads back **completed**.
Google generated Play-signed packages and a signing-certificate fingerprint. The production track
has no release. In **Internal testing → Testers**, confirm/select the tester email list containing
`simone@hologram.xyz` and copy the opt-in link. The API exposes Google Groups but cannot read or
update individual email tester lists or return the opt-in link. Native sign-in, workspace reconnect
and Android push still need verification on the installed release before requesting public review.

Complete the identity/contact/website agreements shown for this developer account. Google may
require additional production-access steps depending on account type; the twelve-tester testing
rule is specifically for qualifying new personal accounts, so do not assume it applies to an
organization account. See [Google's testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465).
