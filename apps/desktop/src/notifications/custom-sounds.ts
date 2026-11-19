import type { SoundEvent } from "./preferences";

/**
 * Sound files people pick for an event. They live in IndexedDB rather than with the other
 * preferences in localStorage, whose few megabytes the whole app shares; only the file's name goes
 * there. A file stays on this device: a phone and a computer each keep their own.
 */
export interface CustomSound {
  name: string;
  /** The file's extension, lower case, which the desktop app's players need to decode it. */
  extension: string;
  bytes: ArrayBuffer;
}

/** A notification sound is a second or two; anything bigger is almost certainly a song. */
export const MAX_CUSTOM_SOUND_BYTES = 1024 * 1024;
export const CUSTOM_SOUND_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac", "aiff"];

/** Why a picked file cannot be used, or null when it can. */
export function customSoundProblem(file: { name: string; size: number }): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!CUSTOM_SOUND_EXTENSIONS.includes(extension))
    return `Choose an audio file (${CUSTOM_SOUND_EXTENSIONS.join(", ")}).`;
  if (file.size > MAX_CUSTOM_SOUND_BYTES) return "Choose a sound file under 1 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

const STORE = "sounds";
let database: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("concors-custom-sounds", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open sound storage"));
  }).catch((error: unknown) => {
    database = null;
    throw error;
  });
  return database;
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const request = action(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error("Could not use sound storage"));
  });
}

export async function saveCustomSound(event: SoundEvent, file: File): Promise<CustomSound> {
  const problem = customSoundProblem(file);
  if (problem) throw new Error(problem);
  const sound: CustomSound = {
    name: file.name,
    extension: file.name.split(".").pop()?.toLowerCase() ?? "mp3",
    bytes: await file.arrayBuffer(),
  };
  await run("readwrite", (store) => store.put(sound, event));
  return sound;
}

export async function readCustomSound(event: SoundEvent): Promise<CustomSound | null> {
  if (typeof indexedDB === "undefined") return null;
  return (await run<CustomSound | undefined>("readonly", (store) => store.get(event))) ?? null;
}
