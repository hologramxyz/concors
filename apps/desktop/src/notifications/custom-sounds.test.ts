import { expect, it } from "vitest";
import { customSoundProblem } from "./custom-sounds";

it("takes short audio files and explains anything else", () => {
  expect(customSoundProblem({ name: "Gong.WAV", size: 40_000 })).toBeNull();
  expect(customSoundProblem({ name: "notes.txt", size: 10 })).toMatch(/^Choose an audio file/);
  expect(customSoundProblem({ name: "album.mp3", size: 8_000_000 })).toBe(
    "Choose a sound file under 1 MB.",
  );
  expect(customSoundProblem({ name: "empty.mp3", size: 0 })).toBe("That file is empty.");
});
