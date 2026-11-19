import { test, expect, signedIn } from "./signed-in.ts";

/** A tenth of a second of a 440 Hz tone, as a 16-bit mono WAV file. */
function tone(): Buffer {
  const rate = 8000,
    samples = 800;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return wav;
}

test("each agent sound can be picked, previewed, replaced by your own file and turned down", async ({
  page,
}) => {
  // Count what Web Audio actually starts, and at which volume, without needing speakers.
  await page.addInitScript(() => {
    const plays: { volume: number; duration: number }[] = [];
    Object.assign(window, { plays });
    const start = AudioBufferSourceNode.prototype.start;
    const connect = AudioNode.prototype.connect as (...args: unknown[]) => AudioNode;
    const gains = new WeakMap<AudioNode, number>();
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      if (this instanceof AudioBufferSourceNode && args[0] instanceof GainNode)
        gains.set(this, args[0].gain.value);
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args) {
      plays.push({ volume: gains.get(this) ?? 1, duration: this.buffer?.duration ?? 0 });
      return start.apply(this, args);
    };
  });
  const plays = () =>
    page.evaluate(() => (window as unknown as { plays: { volume: number }[] }).plays.length);
  const stored = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("concors.notifications.v2") ?? "{}") as unknown,
    );
  const openSettings = async () => {
    await page.getByRole("button", { name: /^Account:/ }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Notifications", exact: true })
      .click();
  };
  await signedIn(page);
  await page.goto("/");
  await openSettings();

  const finished = page.getByRole("button", { name: "Agent finished sound", exact: true });
  await expect(finished).toHaveText("Classic");
  await expect(
    page.getByRole("button", { name: "Needs your input sound", exact: true }),
  ).toHaveText("Request");
  await finished.click();
  await page.getByRole("menuitem", { name: "Bell", exact: true }).click();
  await expect(finished).toHaveText("Bell");
  await expect.poll(plays).toBe(1);
  await expect.poll(stored).toMatchObject({ sounds: { done: "bell", needs_input: "request" } });

  await page.getByRole("slider", { name: "Sound volume" }).fill("40");
  await expect(page.getByText("40%", { exact: true })).toBeVisible();
  await expect.poll(stored).toMatchObject({ volume: 0.4 });
  await page.getByRole("button", { name: "Play agent finished sound", exact: true }).click();
  await expect.poll(plays).toBe(2);
  // Web Audio keeps gain as a 32-bit float.
  expect(
    await page.evaluate(
      () => (window as unknown as { plays: { volume: number }[] }).plays[1]?.volume,
    ),
  ).toBeCloseTo(0.4);

  await page
    .getByLabel("Agent finished sound file", { exact: true })
    .setInputFiles({ name: "gong.wav", mimeType: "audio/wav", buffer: tone() });
  await expect(finished).toHaveText("gong.wav");
  await expect.poll(plays).toBe(3);
  // The picked file is what plays, not a built-in sound: it is a tenth of a second long.
  expect(
    await page.evaluate(
      () => (window as unknown as { plays: { duration: number }[] }).plays[2]?.duration,
    ),
  ).toBeCloseTo(0.1);
  await expect
    .poll(stored)
    .toMatchObject({ sounds: { done: "custom" }, customNames: { done: "gong.wav" } });

  const input = page.getByRole("button", { name: "Needs your input sound", exact: true });
  await input.click();
  await page.getByRole("menuitem", { name: "None", exact: true }).click();
  await expect(input).toHaveText("None");
  await expect(
    page.getByRole("button", { name: "Play needs your input sound", exact: true }),
  ).toBeDisabled();

  // Choices survive a reload, and the master switch hides them without forgetting them.
  await page.reload();
  await openSettings();
  await expect(finished).toHaveText("gong.wav");
  await page.getByLabel("Agent sounds", { exact: true }).uncheck();
  await expect(finished).toHaveCount(0);
  await page.getByLabel("Agent sounds", { exact: true }).check();
  await expect(finished).toHaveText("gong.wav");
  await expect(page.getByText("40%", { exact: true })).toBeVisible();
});
