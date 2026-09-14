# Dictation in agent chat

On supported desktop browsers, the microphone replaces the composer with a recording view. A volume meter beside the microphone and a waveform spanning the input show the actual microphone signal; the timer shows recording duration. The controls use the app's existing compact button sizes and theme colors.

- **Enter / Send:** stop capture, wait for the speech service's final result, and send the text through the existing chat submission path. A working agent queues the message as usual. Empty dictation never sends an existing draft or attachment by itself.
- **Stop:** finish capture and show the transcript for review without sending.
- **Edit:** finish capture and return the text to a focused, editable composer.
- **Cancel / Escape:** discard the current dictation and restore the draft from before recording. Existing attachments remain.

Dictated words update the session's existing draft storage while recording. Switching tabs, hiding the app, disconnecting, or closing the composer releases capture; a pending Send cannot deliver after leaving the tab or disconnecting. Recognition errors and a five-second finalization timeout keep captured words available for review, without sending automatically. Late callbacks from a canceled recording cannot overwrite a newer draft.

The waveform uses a local Web Audio analyser at up to 20 samples per second. It does not record or upload audio. The browser's existing speech-recognition service still performs transcription and may use its own network service. A separate microphone stream is used only for metering; every track and audio context is released on completion, cancel, failure, or unmount, including when permission arrives after cancellation. If metering is unavailable, transcription can continue and the meter reports that its level is unavailable. Reduced motion hides the scrolling waveform history while retaining the live level meter.

This does not add a new transcription backend. Browser/webview availability of SpeechRecognition or webkitSpeechRecognition still applies; unsupported desktop engines keep dictation disabled. Mobile retains OS keyboard dictation. Real microphone hardware and OS-specific native speech services need manual device verification; automated coverage uses deterministic speech events and microphone samples.

Implementation references: [SpeechRecognition.stop](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop) and [AnalyserNode.getFloatTimeDomainData](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getFloatTimeDomainData).

Tests: `dictation-session.test.ts` covers finalization, cancellation, errors, stale callbacks, timeouts, and draft limits. `dictation-audio.test.ts` covers measured volume and capture cleanup. `e2e/dictation.spec.ts` covers Enter, Edit, Stop, Cancel, permission failure, tab changes, reduced motion, and narrow layouts; the existing composer journey covers attachments and queued-message integration.
