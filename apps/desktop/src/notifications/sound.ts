// Google Material Design product sounds, CC BY 4.0, trimmed. See third-party/source-notices.md.
import doneUrl from "./sounds/done.mp3";
import requestUrl from "./sounds/request.mp3";
import { isTauri, playNativeSound } from "@/tauri";
let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
/** The desktop app plays through the OS like Herdr; browsers need a gesture to unlock Web Audio. */
export async function unlockAudio(): Promise<void> {
  if (isTauri()) return;
  context ??= new AudioContext();
  await context.resume();
}
export async function playAgentSound(kind: "done" | "needs_input"): Promise<void> {
  if (isTauri()) return playNativeSound(kind);
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
