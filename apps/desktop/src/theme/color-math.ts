/** Theme colors are schema-validated six/eight-digit hex values. */
function rgb(color: string): [number, number, number] {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

export function mixColor(color: string, toward: string, amount: number): string {
  const target = rgb(toward);
  return `#${rgb(color)
    .map((channel, index) =>
      Math.round(channel + (target[index]! - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function opaqueColor(color: string, background: string): string {
  return color.length === 9
    ? mixColor(background, color, parseInt(color.slice(7), 16) / 255)
    : color;
}

function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
}

export function contrastRatio(color: string, background: string): number {
  const a = luminance(opaqueColor(color, background));
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Adjust derived colors only; explicit terminal overrides remain untouched. */
export function readableColor(color: string, background: string): string {
  const opaque = opaqueColor(color, background);
  if (contrastRatio(opaque, background) >= 4.5) return opaque;
  const target =
    contrastRatio("#000000", background) > contrastRatio("#ffffff", background)
      ? "#000000"
      : "#ffffff";
  for (let step = 1; step <= 100; step++) {
    const candidate = mixColor(opaque, target, step / 100);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return target;
}
