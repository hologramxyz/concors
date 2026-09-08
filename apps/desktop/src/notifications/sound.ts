// Herdr's Apache-2.0 sound assets, revision b99002ac99b09e00b4ca692436cb15a6b0d676f1.
// See third-party/herdr-LICENSE and docs/agent-notifications.md.
import doneUrl from "./sounds/done.mp3";
import requestUrl from "./sounds/request.mp3";
let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
export async function unlockAudio(): Promise<void> {
  context ??= new AudioContext();
  await context.resume();
}
export async function playAgentSound(kind: "done" | "needs_input"): Promise<void> {
  if (!context || context.state !== "running") return;
  const audio = context;
  const url = kind === "done" ? doneUrl : requestUrl;
  let buffer = buffers.get(url);
  if (!buffer) {
    buffer = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Could not load notification sound");
        return r.arrayBuffer();
      })
      .then((data) => audio.decodeAudioData(data));
    buffers.set(url, buffer);
  }
  try {
    const source = audio.createBufferSource();
    source.buffer = await buffer;
    source.connect(audio.destination);
    source.start();
  } catch (error) {
    buffers.delete(url);
    throw error;
  }
}
