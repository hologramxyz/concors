/** Render marketing copy around intact native captures; no network or user data is needed. */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.dirname(fileURLToPath(import.meta.url));
const campaign = JSON.parse(await fs.readFile(path.join(root, "campaign.json"), "utf8"));
const data = async (name, mime) =>
  `data:${mime};base64,${(await fs.readFile(path.join(root, "source", name))).toString("base64")}`;
const escape = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const font = await data("geist-latin.woff2", "font/woff2");
const background = await data("campaign-background.png", "image/png");
const logo = (await fs.readFile(path.resolve(root, "../../../desktop/public/favicon.svg"), "utf8"))
  .replace(' color="#20211f"', "")
  .replace(/<rect[^>]*\/>/, "");
const styles = `
@font-face{font-family:Geist;src:url('${font}') format('woff2');font-weight:100 900;font-style:normal;font-display:block}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Geist,Arial,sans-serif;-webkit-font-smoothing:antialiased;background:#deddd8}.slide{position:relative;width:1206px;height:2622px;overflow:hidden;background:#f4f2ed;color:#20211f;isolation:isolate}
.backdrop{position:absolute;inset:0;background:url('${background}') center/cover;z-index:-2}.ink{background:#20211f;color:#f4f2ed}.ink .backdrop{opacity:.075;mix-blend-mode:screen}.ink:after{content:'';position:absolute;z-index:-1;width:1100px;height:1100px;left:300px;top:1250px;background:radial-gradient(ellipse,#5965a32b,transparent 65%)}
.masthead{position:absolute;top:84px;left:82px;right:82px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:16px;font-size:40px;font-weight:580;letter-spacing:-1.6px}.brand svg{width:62px;height:62px}.category{font-size:22px;letter-spacing:3px;font-weight:500;opacity:.66}.rule{position:absolute;top:182px;left:82px;right:82px;border-top:1px solid currentColor;opacity:.18}
.copy{position:absolute;top:240px;left:82px;right:66px}.eyebrow{font-size:23px;letter-spacing:3px;font-weight:550;opacity:.6;margin-bottom:35px}h1{font-size:115px;line-height:1.015;letter-spacing:-7px;font-weight:630;margin:0}h1 span{display:block;white-space:nowrap}.description{font-size:35px;line-height:1.38;letter-spacing:-.6px;max-width:970px;margin:31px 0 0;opacity:.74}
.device{position:absolute;top:704px;left:181px;width:844px;border-radius:111px;padding:12px;background:linear-gradient(110deg,#505153,#141515 32%,#70716f 70%,#191a1a);box-shadow:0 55px 95px #1415122b,0 9px 15px #0002;outline:1px solid #3336}.ink .device{box-shadow:0 55px 110px #0007,0 0 0 1px #91928a44}.screen{position:relative;overflow:hidden;border-radius:101px;background:#f4f3ef}.screen img{display:block;width:100%;height:auto}.island{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:235px;height:61px;border-radius:40px;background:#090a09;box-shadow:inset 0 0 0 1px #0007}.island:after{content:'';position:absolute;width:14px;height:14px;border-radius:50%;right:20px;top:23px;background:#102032;box-shadow:inset 0 0 5px #23314b}
.footer{position:absolute;bottom:48px;left:82px;right:82px;display:flex;justify-content:space-between;align-items:center;letter-spacing:2.8px;font-size:19px;font-weight:550;opacity:.6}.footer{z-index:3}.number{font-variant-numeric:tabular-nums}

`;
const frames = await Promise.all(
  campaign.frames.map(async (frame, index) => {
    const screenshot = await data(frame.screen, "image/png");
    return `<section class="slide ${escape(frame.theme)}" data-id="${escape(frame.id)}"><div class="backdrop"></div><div class="masthead"><div class="brand">${logo}<span>concors</span></div><div class="category">AGENT ORCHESTRATOR</div></div><div class="rule"></div><div class="copy"><div class="eyebrow">${escape(frame.eyebrow)}</div><h1>${frame.headline.map((line) => `<span>${escape(line)}</span>`).join("")}</h1><p class="description">${escape(frame.description)}</p></div><div class="device"><div class="screen"><img alt="Native Concors screen: ${escape(frame.id)}" src="${screenshot}">${frame.systemIsland ? "" : '<div class="island"></div>'}</div></div><div class="footer"><span>${escape(frame.footer)}</span><span class="number">0${index + 1} / 04</span></div></section>`;
  }),
);
const html = (body, extra = "") =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Concors App Store campaign</title><style>${styles}${extra}</style><body>${body}</body></html>`;
const browser = await chromium.launch({ headless: true });
const output = path.join(root, "exports");
await fs.mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: campaign.width, height: campaign.height },
    deviceScaleFactor: 1,
  });
  for (const [index, frame] of campaign.frames.entries()) {
    await page.setContent(html(frames[index]));
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page
      .locator("img")
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    await page.screenshot({ path: path.join(output, `${frame.id}.png`), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1616, height: 958 });
  const overview = html(
    frames.map((frame) => `<div class="thumb">${frame}</div>`).join(""),
    `body{display:flex;gap:16px;padding:24px}.thumb{width:380px;height:826px;overflow:hidden;box-shadow:0 4px 15px #0002}.thumb .slide{transform:scale(.31509);transform-origin:top left}`,
  );
  await page.setContent(overview);
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page
    .locator("img")
    .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await page.screenshot({
    path: path.join(output, "campaign-overview.png"),
    animations: "disabled",
  });
  await fs.writeFile(
    path.join(root, "campaign.html"),
    html(frames.join(""), "body{display:flex;gap:32px;padding:32px}.slide{flex-shrink:0}"),
  );
  process.stdout.write(
    JSON.stringify({
      rendered: campaign.frames.map((frame) => `${frame.id}.png`),
      width: campaign.width,
      height: campaign.height,
    }) + "\n",
  );
} finally {
  await browser.close();
}
