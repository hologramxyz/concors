import type { Page } from "@playwright/test";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedSupervisorWorkspaces } from "./support/supervisor-fixture.ts";

/**
 * Where a live mention's tint sits against the message box's own text. The box's words and the
 * copy drawn behind it are shot alone in turn, tints off. Within each tint rectangle (the copy's
 * text box, by construction) the box's ink must reach the same bounds as the copy's, so the tint
 * frames the box's own "@Name". A few pixels can be shaded differently where one layer starts a
 * new run of text; `differing` counts them, for the record.
 */
async function tintAgainstText(page: Page) {
  const box = page.locator("textarea[data-agent-composer]");
  const show = (layer: "box" | "copy" | null) =>
    box.evaluate((el, layer) => {
      const copy = el.previousElementSibling as HTMLElement;
      const ink = (el.dataset["ink"] ??= getComputedStyle(el).color);
      el.style.color = layer === "box" ? ink : layer ? "transparent" : "";
      copy.style.color = layer === "copy" ? ink : "";
      for (const tint of copy.querySelectorAll("span"))
        Object.assign((tint as HTMLElement).style, {
          background: layer ? "transparent" : "",
          boxShadow: layer ? "none" : "",
        });
      if (!layer) delete el.dataset["ink"];
    }, layer);
  const where = async () => {
    const rect = await box.boundingBox();
    if (!rect) throw new Error("The message box is not on screen");
    return rect;
  };
  const shoot = async (clip: Awaited<ReturnType<typeof where>>) => {
    await show("box");
    const own = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
    await show("copy");
    const copied = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
    await show(null);
    return { own, copied, clip };
  };
  await box.evaluate((el) => el.blur());
  // Leaving the box can move the composer: shoot again until it held still for both shots.
  let shots = await shoot(await where());
  for (let tries = 0; ; tries++) {
    const now = await where();
    const { clip } = shots;
    if (now.x === clip.x && now.y === clip.y && now.height === clip.height) break;
    expect(tries).toBeLessThan(10);
    shots = await shoot(now);
  }
  return box.evaluate(async (el, { own, copied, clip }) => {
    const read = async (data: string) => {
      const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas to read the shots");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [a, b] = [await read(own), await read(copied)];
    const scale = a.width / clip.width;
    const back = [...a.data.subarray(0, 3)];
    const far = (image: ImageData, i: number, from: number[], by: number) =>
      Math.max(...[0, 1, 2].map((c) => Math.abs((image.data[i + c] ?? 0) - (from[c] ?? 0)))) > by;
    const copy = el.previousElementSibling as HTMLElement;
    const rects = [...copy.querySelectorAll("span")].flatMap((tint) => [...tint.getClientRects()]);
    // Against the box as it stands now, in case the composer moved since the shots.
    const at = el.getBoundingClientRect();
    return rects.map((rect) => {
      const tint = {
        left: rect.left - at.left,
        right: rect.right - at.left,
        top: rect.top - at.top,
        bottom: rect.bottom - at.top,
      };
      const bounds = (image: ImageData) => {
        const ink = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
        for (let y = Math.floor(tint.top * scale); y < Math.ceil(tint.bottom * scale); y++)
          for (let x = Math.floor(tint.left * scale); x < Math.ceil(tint.right * scale); x++)
            if (far(image, (y * image.width + x) * 4, back, 60)) {
              ink.left = Math.min(ink.left, x / scale);
              ink.right = Math.max(ink.right, (x + 1) / scale);
              ink.top = Math.min(ink.top, y / scale);
              ink.bottom = Math.max(ink.bottom, (y + 1) / scale);
            }
        return ink;
      };
      let differing = 0;
      for (let y = Math.floor(tint.top * scale); y < Math.ceil(tint.bottom * scale); y++)
        for (let x = Math.floor(tint.left * scale); x < Math.ceil(tint.right * scale); x++) {
          const i = (y * a.width + x) * 4;
          if (far(a, i, [...b.data.subarray(i, i + 3)], 24)) differing++;
        }
      return { tint, own: bounds(a), copy: bounds(b), differing };
    });
  }, shots);
}

function expectTintOnText(measured: Awaited<ReturnType<typeof tintAgainstText>>, lines: number) {
  expect(measured).toHaveLength(lines);
  for (const { own, copy } of measured) {
    for (const side of ["left", "right", "top", "bottom"] as const)
      expect(Math.abs(own[side] - copy[side])).toBeLessThanOrEqual(1);
  }
}

/**
 * How far each piece of tint is painted beyond the tint its text box alone would paint, side by
 * side: the box's words hidden, shot with the tint's sides and without them. An edge is where the
 * tint is at least half as strong as its middle, on the middle row and column of each piece.
 */
async function tintPadding(page: Page) {
  const box = page.locator("textarea[data-agent-composer]");
  const shoot = async (sides: boolean) => {
    await box.evaluate((el, sides) => {
      el.blur();
      el.style.color = "transparent";
      for (const tint of el.previousElementSibling?.querySelectorAll("span") ?? [])
        (tint as HTMLElement).style.boxShadow = sides ? "" : "none";
    }, sides);
    const clip = await box.boundingBox();
    if (!clip) throw new Error("The message box is not on screen");
    const shot = (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
    return { shot, clip };
  };
  const shots = { padded: await shoot(true), bare: await shoot(false) };
  await box.evaluate((el) => {
    el.style.color = "";
    for (const tint of el.previousElementSibling?.querySelectorAll("span") ?? [])
      (tint as HTMLElement).style.boxShadow = "";
  });
  return box.evaluate(async (el, { padded, bare }) => {
    const copy = el.previousElementSibling as HTMLElement;
    const at = el.getBoundingClientRect();
    const rects = [...copy.querySelectorAll("span")].flatMap((tint) => [...tint.getClientRects()]);
    const edges = async ({ shot, clip }: typeof padded) => {
      const blob = await (await fetch(`data:image/png;base64,${shot}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas to read the shot");
      context.drawImage(bitmap, 0, 0);
      const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const scale = image.width / clip.width;
      const back = [...image.data.subarray(0, 3)];
      const strength = (x: number, y: number) => {
        const i = (y * image.width + x) * 4;
        return Math.max(
          ...[0, 1, 2].map((c) => Math.abs((image.data[i + c] ?? 0) - (back[c] ?? 0))),
        );
      };
      return rects.map((rect) => {
        const [left, right] = [rect.left - at.left, rect.right - at.left];
        const [top, bottom] = [rect.top - at.top, rect.bottom - at.top];
        const row = Math.round(((top + bottom) / 2) * scale);
        const column = Math.round(((left + right) / 2) * scale);
        const half = strength(column, row) / 2;
        const reach = (from: number, to: number, step: number, at: (n: number) => number) => {
          let edge = from;
          for (let n = from; n !== to; n += step) if (at(n) >= half) edge = n;
          return edge;
        };
        const across = (x: number) => strength(x, row);
        const down = (y: number) => strength(column, y);
        return {
          left: reach(column, Math.floor((left - 4) * scale), -1, across) / scale,
          right: (reach(column, Math.ceil((right + 4) * scale), 1, across) + 1) / scale,
          top: reach(row, Math.floor((top - 4) * scale), -1, down) / scale,
          bottom: (reach(row, Math.ceil((bottom + 4) * scale), 1, down) + 1) / scale,
        };
      });
    };
    const [wide, plain] = [await edges(padded), await edges(bare)];
    return wide.map((piece, index) => {
      const own = plain[index] ?? piece;
      return {
        left: own.left - piece.left,
        right: piece.right - own.right,
        top: own.top - piece.top,
        bottom: piece.bottom - own.bottom,
      };
    });
  }, shots);
}

/** The tint reaches 1px past its text on either side, and no further up or down. */
function expectTintPadded(padding: Awaited<ReturnType<typeof tintPadding>>, lines: number) {
  expect(padding).toHaveLength(lines);
  for (const piece of padding) {
    expect(piece).toEqual({ left: 1, right: 1, top: 0, bottom: 0 });
  }
}

test("@ in the Supervisor's message lists agents and writes the chosen mention", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const cleanup = await seedSupervisorWorkspaces("ws://127.0.0.1:7429/ws", { delegate: false });
  try {
    await signedIn(page, "Simone", undefined, { supervisorLanding: true });
    await page.goto("/");
    const dismissAccount = page.getByRole("button", { name: "Dismiss account connection" });
    if (await dismissAccount.isVisible()) await dismissAccount.click();
    const dismissAnnouncement = page.getByRole("button", { name: "Dismiss iOS app announcement" });
    if (await dismissAnnouncement.isVisible()) await dismissAnnouncement.click();

    // @ lists agents and workspaces as / lists commands, and writes the mention into the text.
    const composer = page.getByRole("textbox", { name: "Message Codex", exact: true });
    await composer.fill("Ask @ga");
    const mentions = page.getByRole("listbox", { name: "Mention" });
    await expect(mentions.getByRole("option", { name: /Game QA/ })).toBeVisible();
    await expect(mentions.getByRole("option", { name: /HUD polish/ })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("desktop-mentions.png"),
      animations: "disabled",
    });
    await composer.press("Enter");
    await expect(mentions).toHaveCount(0);
    await expect(composer).toHaveValue("Ask @Game QA ");
    await composer.pressSequentially("to rerun the tests");
    await page.screenshot({
      path: test.info().outputPath("desktop-mention-written.png"),
      animations: "disabled",
    });
    // Escape hides the list until something else is typed.
    await composer.fill("Then @rel");
    await expect(mentions.getByRole("option", { name: /Release editor/ })).toBeVisible();
    await composer.press("Escape");
    await expect(mentions).toHaveCount(0);
    // Typing straight after choosing a mention lands after it, however fast the keys come.
    await composer.fill("And @rel");
    await expect(mentions.getByRole("option", { name: /Release editor/ })).toBeVisible();
    await composer.press("Enter");
    await composer.pressSequentially("to update the notes");
    await expect(composer).toHaveValue("And @Release editor to update the notes");
    // The chosen mention is tinted on a copy behind the box, exactly over its own text and 1px
    // past it on either side: on one line, and wrapped across two.
    const one = await tintAgainstText(page);
    console.warn(`tint one line: ${JSON.stringify(one)}`);
    expectTintOnText(one, 1);
    const onePadding = await tintPadding(page);
    console.warn(`tint padding one line: ${JSON.stringify(onePadding)}`);
    expectTintPadded(onePadding, 1);
    let words = "";
    for (let n = 0; n < 60; n++) {
      words += "wrap ";
      await composer.fill(`${words}@rel`);
      await expect(mentions.getByRole("option", { name: /Release editor/ })).toBeVisible();
      await composer.press("Enter");
      const lines = await page.evaluate(
        () =>
          document
            .querySelector("textarea[data-agent-composer]")
            ?.previousElementSibling?.querySelector("span")
            ?.getClientRects().length ?? 0,
      );
      if (lines === 2) break;
    }
    const wrapped = await tintAgainstText(page);
    console.warn(`tint wrapped: ${JSON.stringify(wrapped)}`);
    expectTintOnText(wrapped, 2);
    const wrappedPadding = await tintPadding(page);
    console.warn(`tint padding wrapped: ${JSON.stringify(wrappedPadding)}`);
    expectTintPadded(wrappedPadding, 2);
    // Not sent: the Supervisor conversation is shared by every spec on this daemon. How a sent
    // mention reads is covered by src/supervisor/sent-mentions.test.ts.
    await composer.fill("");
  } finally {
    await cleanup();
  }
});
