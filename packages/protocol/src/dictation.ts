import { z } from "zod";

/**
 * Dictation: the client streams microphone audio to the daemon hosting the agent and the daemon
 * transcribes it with a local speech model. Webviews without a speech service (WebKitGTK, WebView2)
 * can dictate this way, and no audio leaves the user's own machines.
 *
 * The daemon advertises `DICTATION_CAPABILITY`; clients declare the same string in `client.hello`
 * to receive dictation events, so older clients never see message types they cannot parse.
 */
export const DICTATION_CAPABILITY = "dictation-v1";

/** Audio is 16-bit little-endian mono PCM at this rate, base64-encoded per chunk. */
export const DICTATION_SAMPLE_RATE = 16_000;

/** A chunk carries at most one second of audio. */
export const DICTATION_MAX_CHUNK_BASE64 = Math.ceil((DICTATION_SAMPLE_RATE * 2) / 3) * 4;

/** Recordings end here, so a forgotten microphone cannot fill the daemon's memory. */
export const DICTATION_MAX_SECONDS = 10 * 60;

export const DictationModelSchema = z.discriminatedUnion("state", [
  /** Not downloaded yet; the daemon starts the download on its own. */
  z.object({ state: z.literal("missing") }),
  z.object({
    state: z.literal("downloading"),
    receivedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().positive(),
  }),
  z.object({ state: z.literal("ready") }),
  z.object({ state: z.literal("failed"), message: z.string().max(1000) }),
]);
export type DictationModel = z.infer<typeof DictationModelSchema>;

const DictationId = z.string().uuid();

export const DictationOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("status") }),
  /** Retries a failed model download. */
  z.object({ kind: z.literal("prepare") }),
  z.object({ kind: z.literal("start"), dictationId: DictationId }),
  /** Transcribes the audio received so far, then emits one final transcript. */
  z.object({ kind: z.literal("finish"), dictationId: DictationId }),
  z.object({ kind: z.literal("cancel"), dictationId: DictationId }),
]);
export type DictationOperation = z.infer<typeof DictationOperationSchema>;

export const DictationRequestSchema = z.object({
  type: z.literal("dictation.request"),
  requestId: z.string().uuid(),
  operation: DictationOperationSchema,
});
export type DictationRequest = z.infer<typeof DictationRequestSchema>;

/** Fire-and-forget audio. `seq` starts at 0 so the daemon can reject gaps instead of garbling. */
export const DictationAudioSchema = z.object({
  type: z.literal("dictation.audio"),
  dictationId: DictationId,
  seq: z.number().int().nonnegative(),
  pcm: z.string().max(DICTATION_MAX_CHUNK_BASE64).base64(),
});
export type DictationAudio = z.infer<typeof DictationAudioSchema>;

export const DictationResultSchema = z.object({
  type: z.literal("dictation.result"),
  requestId: z.string().uuid(),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), model: DictationModelSchema }),
    z.object({ status: z.literal("error"), message: z.string().max(1000) }),
  ]),
});
export type DictationResult = z.infer<typeof DictationResultSchema>;

export const DictationEventSchema = z.discriminatedUnion("type", [
  /** Broadcast to dictation clients whenever the model's availability changes. */
  z.object({ type: z.literal("dictation.model"), model: DictationModelSchema }),
  /**
   * The whole transcript so far, so a revised partial replaces earlier words. After `final`, or
   * after an `error`, the daemon sends nothing more for this dictation.
   */
  z.object({
    type: z.literal("dictation.transcript"),
    dictationId: DictationId,
    text: z.string().max(16_000),
    final: z.boolean(),
  }),
  z.object({
    type: z.literal("dictation.error"),
    dictationId: DictationId,
    message: z.string().max(1000),
  }),
]);
export type DictationEvent = z.infer<typeof DictationEventSchema>;
