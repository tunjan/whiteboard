/**
 * The viewport frame drawn under the pointer during a Quick Zoom. Its size is
 * the region that will fill the screen once the key is released, so the frame
 * is a literal preview of where you are about to land.
 */
export function QuickZoomFrame({
  center,
  width,
  height,
}: {
  center: { x: number; y: number };
  width: number;
  height: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[var(--z-canvas-hud)] rounded-[2px] border-2 border-[var(--action-solid,#3b82f6)] bg-[color-mix(in_srgb,var(--action-solid,#3b82f6)_10%,transparent)]"
      style={{
        left: center.x - width / 2,
        top: center.y - height / 2,
        width,
        height,
      }}
    />
  );
}
