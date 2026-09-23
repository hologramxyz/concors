import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, signedIn } from "./signed-in.ts";
import { seedProject } from "./support/projects.ts";
import { mockChatHistory } from "./support/chat-history.ts";

test("chat stays pinned to the bottom until the user scrolls up, and sending returns there", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const directory = await mkdtemp(join(tmpdir(), "concors-follow-browser-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const history = await mockChatHistory(page);
  try {
    await signedIn(page);
    await page.goto("/");
    await seedProject(page, "Follow the bottom", directory);
    await page.getByRole("button", { name: "New tab", exact: true }).click();
    await page.getByRole("menuitem", { name: "Agent", exact: true }).click();
    const timeline = page.getByRole("log", { name: "Chat timeline" });
    const latest = page.getByRole("button", { name: "Latest", exact: true });
    await expect(timeline.getByText("History 0 message 639", { exact: true })).toBeVisible();
    const distance = () =>
      timeline.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    await expect.poll(distance).toBeLessThanOrEqual(2);
    // A block collapses and another grows before the scroll event fires: scrollTop drops while
    // the bottom moves away, which is not the user scrolling up.
    for (let round = 0; round < 3; round++) {
      await timeline.evaluate(async (el) => {
        const block = document.createElement("div");
        block.style.height = "600px";
        el.firstElementChild?.append(block);
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve))),
        );
        block.style.height = "0px";
        void el.scrollTop;
        block.style.height = "900px";
        // Deliver the clamp's scroll event before the resize observer re-pins, as WebKit may.
        el.dispatchEvent(new Event("scroll"));
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve))),
        );
      });
      await expect(latest).toHaveCount(0);
      await expect.poll(distance).toBeLessThanOrEqual(2);
    }
    history.append();
    await expect(timeline.getByText("History 0 message 640", { exact: true })).toBeVisible();
    await expect.poll(distance).toBeLessThanOrEqual(2);
    // Scrolling up by hand stops following.
    await timeline.hover();
    await page.mouse.wheel(0, -600);
    await expect(latest).toBeVisible();
    const reading = await timeline.evaluate((el) => el.scrollTop);
    history.append();
    await expect(timeline.getByText("History 0 message 641", { exact: true })).toBeAttached();
    expect(Math.abs((await timeline.evaluate((el) => el.scrollTop)) - reading)).toBeLessThan(2);
    // Scrolling back down by hand resumes following.
    await page.mouse.wheel(0, 5_000);
    await expect(latest).toHaveCount(0);
    history.append();
    await expect(timeline.getByText("History 0 message 642", { exact: true })).toBeVisible();
    await expect.poll(distance).toBeLessThanOrEqual(2);
    // Sending from the composer while scrolled up jumps back to the bottom.
    await page.mouse.wheel(0, -600);
    await expect(latest).toBeVisible();
    const input = page.getByRole("textbox", { name: "Message Codex" });
    await expect(input).toBeEnabled();
    await input.fill("Take me back down");
    await input.press("Enter");
    await expect(latest).toHaveCount(0);
    await expect.poll(distance).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
