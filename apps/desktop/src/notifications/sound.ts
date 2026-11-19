// Classic and Request are Google Material Design product sounds, CC BY 4.0, trimmed; see
// third-party/source-notices.md. The others are synthesized by scripts/notification-sounds.py.
import done from "./sounds/done.mp3";
import request from "./sounds/request.mp3";
import chime from "./sounds/chime.mp3";
import ping from "./sounds/ping.mp3";
import pop from "./sounds/pop.mp3";
import bell from "./sounds/bell.mp3";
import rise from "./sounds/rise.mp3";
import knock from "./sounds/knock.mp3";
import { isTauri, playNativeSound } from "@/tauri";
import {
  DEFAULT_SOUNDS,
  getNotificationPreferences,
  type BuiltInSound,
  type SoundChoice,
  type SoundEvent,
} from "./preferences";
import { readCustomSound, type CustomSound } from "./custom-sounds";

const URLS: Record<BuiltInSound, string> = { done, request, chime, ping, pop, bell, rise, knock };
let context: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
/** The desktop app plays through the OS like Herdr; browsers need a gesture to unlock Web Audio. */
export async function unlockAudio(): Promise<void> {
  if (isTauri()) return;
  context ??= new AudioContext();
  await context.resume();
}

/**
 * Plays an event's sound as set in Settings, or `preview`'s choice and volume before they are
 * saved. A custom choice whose file is gone, such as after site data was cleared, falls back to
 * the event's default rather than going quiet.
 */
export async function playAgentSound(
  event: SoundEvent,
  preview: { choice?: SoundChoice; volume?: number } = {},
): Promise<void> {
  const preferences = getNotificationPreferences();
  const choice = preview.choice ?? preferences.sounds[event];
  const volume = preview.volume ?? preferences.volume;
  if (choice === "none" || volume <= 0) return;
  const custom = choice === "custom" ? await readCustomSound(event).catch(() => null) : null;
  const sound = custom ?? (choice === "custom" ? DEFAULT_SOUNDS[event] : choice);
  if (isTauri()) return playNativeSound(sound, volume);
  await playInBrowser(sound, volume);
}

async function playInBrowser(sound: BuiltInSound | CustomSound, volume: number) {
  if (!context || context.state !== "running") return;
  const audio = context;
  // Built-in sounds are decoded once; a custom one each time, since it can be replaced.
  const key = typeof sound === "string" ? sound : null;
  let buffer = key ? buffers.get(key) : undefined;
  if (!buffer) {
    buffer = (
      typeof sound === "string"
        ? fetch(URLS[sound]).then((r) => {
            if (!r.ok) throw new Error("Could not load notification sound");
            return r.arrayBuffer();
          })
        : // decodeAudioData detaches the buffer it is given, so it gets a copy.
          Promise.resolve(sound.bytes.slice(0))
    ).then((data) => audio.decodeAudioData(data));
    if (key) buffers.set(key, buffer);
  }
  try {
    const source = audio.createBufferSource();
    const gain = audio.createGain();
    gain.gain.value = volume;
    source.buffer = await buffer;
    source.connect(gain).connect(audio.destination);
    source.start();
  } catch (error) {
    if (key) buffers.delete(key);
    throw error;
  }
}
