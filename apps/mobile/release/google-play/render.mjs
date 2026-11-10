/** Compose Play marketing assets around unchanged captures from the installed Android app. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.dirname(fileURLToPath(import.meta.url));
const campaign = JSON.parse(await fs.readFile(path.join(root, "campaign.json"), "utf8"));
const evidence = JSON.parse(await fs.readFile(path.join(root, "capture-evidence.json"), "utf8"));
assert.equal(evidence.platform, "android");
assert.equal(evidence.nativeRunConclusion, "success");
const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const source = async (filename) => {
  const buffer = await fs.readFile(path.join(root, "source", filename));
  assert.equal(hash(buffer), evidence.screens[filename].sha256, `Unverified source: ${filename}`);
  assert(buffer.readUInt32BE(16) >= 1080 && buffer.readUInt32BE(20) >= 1920);
  return `data:image/png;base64,${buffer.toString("base64")}`;
};
const shared = async (name, mime) =>
  `data:${mime};base64,${(await fs.readFile(path.join(root, "../marketing/source", name))).toString("base64")}`;
const font = await shared("geist-latin.woff2", "font/woff2");
const background = await shared("campaign-background.png", "image/png");
const icon = await fs.readFile(path.resolve(root, "../../assets/icon.png"));
const logo = (await fs.readFile(path.resolve(root, "../../../desktop/public/favicon.svg"), "utf8"))
  .replace(' color="#20211f"', "")
  .replace(/<rect[^>]*\/>/, "");
const escape = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const styles = `
@font-face{font-family:Geist;src:url('${font}') format('woff2');font-weight:100 900;font-display:block}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Geist,Arial,sans-serif;-webkit-font-smoothing:antialiased;background:#deddd8}.slide{position:relative;width:1080px;height:1920px;overflow:hidden;background:#f4f2ed;color:#20211f;isolation:isolate}
.backdrop{position:absolute;inset:0;background:url('${background}') center/cover;z-index:-2}.ink{background:#20211f;color:#f4f2ed}.ink .backdrop{opacity:.075;mix-blend-mode:screen}
.masthead{position:absolute;top:46px;left:66px;right:66px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:13px;font-size:35px;font-weight:580;letter-spacing:-1.4px}.brand svg{width:52px;height:52px}.category{font-size:18px;letter-spacing:2.7px;opacity:.65}.rule{position:absolute;top:125px;left:66px;right:66px;border-top:1px solid currentColor;opacity:.18}
.copy{position:absolute;top:165px;left:66px;right:48px}.eyebrow{font-size:19px;letter-spacing:2.2px;font-weight:550;opacity:.63;margin-bottom:22px}h1{font-size:89px;line-height:1.02;letter-spacing:-5px;font-weight:630;margin:0}h1 span{display:block;white-space:nowrap}.description{font-size:27px;line-height:1.3;letter-spacing:-.4px;margin:23px 0 0;opacity:.76}
.device{position:absolute;top:463px;left:226px;width:628px;border-radius:53px;padding:9px;background:linear-gradient(110deg,#666966,#171918 40%,#6a6d68 75%,#191a1a);box-shadow:0 30px 65px #14151233,0 4px 10px #0003;outline:1px solid #3337}.ink .device{box-shadow:0 30px 65px #0007;outline:1px solid #91928a66}.screen{overflow:hidden;border-radius:45px;background:#f4f3ef}.screen img{display:block;width:100%;height:auto}
.footer{position:absolute;bottom:22px;left:66px;right:66px;display:flex;justify-content:space-between;align-items:center;letter-spacing:2px;font-size:14px;font-weight:550;opacity:.65;z-index:3}.number{font-variant-numeric:tabular-nums}
`;
const screens = {};
const frames = await Promise.all(
  campaign.frames.map(async (frame, index) => {
    screens[frame.screen] = await source(frame.screen);
    return `<section class="slide ${escape(frame.theme)}"><div class="backdrop"></div><div class="masthead"><div class="brand">${logo}<span>concors</span></div><div class="category">AGENT ORCHESTRATOR</div></div><div class="rule"></div><div class="copy"><div class="eyebrow">${escape(frame.eyebrow)}</div><h1>${frame.headline.map((line) => `<span>${escape(line)}</span>`).join("")}</h1><p class="description">${escape(frame.description)}</p></div><div class="device"><div class="screen"><img alt="Concors on Android: ${escape(frame.id)}" src="${screens[frame.screen]}"></div></div><div class="footer"><span>${escape(frame.footer)}</span><span class="number">0${index + 1} / 04</span></div></section>`;
  }),
);
const html = (body, extra = "") =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Concors Google Play campaign</title><style>${styles}${extra}</style><body>${body}</body></html>`;
const output = path.join(root, "exports");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const files = [];
try {
  const page = await browser.newPage({
    viewport: { width: campaign.width, height: campaign.height },
    deviceScaleFactor: 1,
  });
  const render = async (filename, body, width, height, extra = "") => {
    await page.setViewportSize({ width, height });
    await page.setContent(html(body, extra));
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page
      .locator("img")
      .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
    const buffer = await page.screenshot({
      path: path.join(output, filename),
      animations: "disabled",
    });
    assert.equal(buffer.readUInt32BE(16), width);
    assert.equal(buffer.readUInt32BE(20), height);
    assert.equal(buffer[25], 2, "Play assets must be RGB without alpha");
    files.push({ filename, width, height, sha256: hash(buffer), bytes: buffer.length });
  };
  for (const [index, frame] of campaign.frames.entries())
    await render(`${frame.id}.png`, frames[index], campaign.width, campaign.height);
  await render(
    "feature-graphic.png",
    `<section class="feature slide"><div class="backdrop"></div><div class="feature-brand brand">${logo}<span>concors</span></div><div class="feature-copy"><h1>Your AI agents.<br>Within reach.</h1><p>AGENT ORCHESTRATOR</p></div><div class="device"><div class="screen"><img alt="Concors Android workspace" src="${screens["marketing-agent.png"]}"></div></div></section>`,
    1024,
    500,
    `.feature{width:1024px;height:500px}.feature-brand{position:absolute;left:64px;top:46px;font-size:32px}.feature-brand svg{width:50px;height:50px}.feature-copy{position:absolute;left:64px;top:165px}.feature h1{font-size:70px;letter-spacing:-3px;line-height:1.07}.feature p{font-size:16px;letter-spacing:3px;opacity:.6;margin-top:30px}.feature .device{top:48px;left:704px;width:252px;padding:5px;border-radius:27px;transform:rotate(-5deg)}.feature .screen{border-radius:22px}`,
  );
  await render(
    "icon.png",
    `<img alt="Concors app icon" src="data:image/png;base64,${icon.toString("base64")}" width="512" height="512">`,
    512,
    512,
    "body{background:#f4f3ef}",
  );
  await render(
    "campaign-overview.png",
    frames.map((frame) => `<div class="thumb">${frame}</div>`).join(""),
    1182,
    528,
    "body{display:flex;gap:18px;padding:24px}.thumb{width:270px;height:480px;overflow:hidden;flex-shrink:0}.thumb .slide{transform:scale(.25);transform-origin:top left}",
  );
  await fs.writeFile(
    path.join(root, "asset-manifest.json"),
    JSON.stringify(
      { platform: "android", locale: campaign.locale, files, iconSourceSha256: hash(icon) },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(JSON.stringify({ rendered: files.map((file) => file.filename) }) + "\n");
} finally {
  await browser.close();
}
