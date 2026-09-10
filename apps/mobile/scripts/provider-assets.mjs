/** Convert only the checked-in, path-only desktop provider marks to native image assets. */
export function providerSvg(source) {
  const viewBox = source.match(/viewBox="([\d.\s-]+)"/)?.[1];
  const paths = source.match(/<path\b[^>]*\/>/gs);
  if (!viewBox || !paths?.length) throw new Error("Unsupported desktop provider icon");
  const body = paths
    .join("")
    .replaceAll("fillRule=", "fill-rule=")
    .replaceAll("clipRule=", "clip-rule=")
    .replace(/opacity=\{([\d.]+)\}/g, 'opacity="$1"');
  if (/[{}]/.test(body)) throw new Error("Provider icon needs an explicit SVG conversion");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="black" fill-rule="evenodd">${body}</svg>`;
}
