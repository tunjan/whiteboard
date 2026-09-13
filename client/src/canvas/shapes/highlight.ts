export const HIGHLIGHT_UNDERLAY_OPACITY = 0.82;
export const HIGHLIGHT_OVERLAY_OPACITY = 0.35;

/** Convert palette sRGB to Display P3 when the renderer supports it. */
export function highlightPaint(color: string): string {
  if (typeof CSS === 'undefined' || !CSS.supports('color', 'color(display-p3 1 1 0)') ||
    !/^#[\da-f]{6}$/i.test(color)) return color;
  const linear = (n: number) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  const encoded = (n: number) => n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055;
  const r = linear(parseInt(color.slice(1, 3), 16) / 255);
  const g = linear(parseInt(color.slice(3, 5), 16) / 255);
  const b = linear(parseInt(color.slice(5, 7), 16) / 255);
  return `color(display-p3 ${encoded(0.822462 * r + 0.177538 * g)} ${encoded(0.033194 * r + 0.966806 * g)} ${encoded(0.017083 * r + 0.072397 * g + 0.910520 * b)})`;
}
