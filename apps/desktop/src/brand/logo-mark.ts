/**
 * The in-app logo mark comes from one file, `brand/incoming/sources/logo-mark.svg`: `BrandMark`
 * imports it, and the Vite config writes it into `index.html`'s startup screen. Only its viewBox and
 * the shapes inside are used; the app sets the colour through `currentColor`.
 */
export interface LogoMark {
  viewBox: string;
  /** SVG markup for the shapes inside the root `<svg>`. */
  body: string;
}

/** Shapes only, so the file is drawn and never runs or loads anything. */
const ALLOWED = new Set(["path", "g", "circle", "ellipse", "rect", "polygon", "polyline", "line"]);

export function parseLogoMark(svg: string): LogoMark {
  const source = svg
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const root = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(source);
  if (!root) throw new Error("logo-mark.svg must be one <svg> element");
  const viewBox = /\bviewBox="([^"]+)"/.exec(root[1] ?? "")?.[1];
  if (!viewBox) throw new Error("logo-mark.svg needs a viewBox on its <svg>");
  const body = (root[2] ?? "").trim();
  for (const [, name = "", attributes = ""] of body.matchAll(/<\/?([^\s/>]+)([^>]*)>/g)) {
    if (!ALLOWED.has(name))
      throw new Error(`logo-mark.svg may only hold ${[...ALLOWED].join(", ")}; found <${name}>`);
    if (/\s(on[\w-]*|href|xlink:href)\s*=/i.test(attributes))
      throw new Error(`logo-mark.svg must not use event handlers or links (in <${name}>)`);
  }
  if (!body) throw new Error("logo-mark.svg draws nothing");
  return { viewBox, body };
}
