import { readFileSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { seedProject } from "./support/projects.ts";
import { test, expect, signedIn } from "./signed-in.ts";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/** Drops files on an element as the webview delivers a drag from Finder or a file manager. */
function dropFiles(target: Locator, files: { name: string; type: string; base64: string }[]) {
  return target.evaluate((element, files) => {
    const data = new DataTransfer();
    for (const file of files)
      data.items.add(
        new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, {
          type: file.type,
        }),
      );
    for (const type of ["dragenter", "dragover", "drop"])
      element.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }),
      );
  }, files);
}

test("dropping an image on a terminal pastes the path of a copy the CLI can read", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signedIn(page);
  await page.goto("/");
  await seedProject(page, "Terminal drop", process.cwd());
  const output = page.getByLabel("Terminal output").filter({ visible: true });
  await expect(output).toBeVisible();
  await output.click();
  await page.keyboard.type("echo ready\n");
  await expect(output).toContainText("ready");

  await dropFiles(output, [{ name: "shot.png", type: "image/png", base64: PNG }]);
  // The path appears at the prompt, as a dropped file's does in other terminals.
  const pasted = /(\/\S*terminal-[\w-]+\/[\w-]+\.png)/;
  await expect(output).toContainText(pasted);
  const path = pasted.exec((await output.textContent()) ?? "")?.[1];
  if (!path) throw new Error("No pasted path");
  expect(readFileSync(path).toString("base64")).toBe(PNG);

  // Anything but an image says why nothing was pasted.
  await dropFiles(output, [{ name: "notes.txt", type: "text/plain", base64: btoa("hello") }]);
  await expect(page.getByRole("alert")).toContainText("Only images can be dropped");
  expect(errors).toEqual([]);
});
