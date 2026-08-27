import { useEffect, useRef, useState } from 'react';
import type { ImageShape } from '@whiteboard/shared';
import { blobUrl } from '../board/blobs';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import { editor } from './use-document-store';
import { useImageCroppingStore } from './use-image-cropping-store';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest crop, in world units. */
const MIN = 16;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type HandleId = (typeof HANDLES)[number];

const CURSORS: Record<HandleId, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

/** Rotate a vector by `rad` (used to map screen drag into the shape's frame). */
function rotateVec(x: number, y: number, rad: number) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: x * c - y * s, y: x * s + y * c };
}

/**
 * Interactive, non-destructive crop UI for an image shape. Mirrors the
 * text-editing overlay: the shape is hidden in the SVG canvas while this layer
 * is up. Shows the full source dimmed with a draggable crop rectangle; commits
 * the visible sub-rect as `props.crop` (fractions) plus a new box.
 */
export function ImageCropOverlay({
  shape,
  camera,
}: {
  shape: ImageShape;
  camera: Camera;
}) {
  const stop = useImageCroppingStore((s) => s.stop);

  // The full source's world rect (fixed for the session) and the live crop rect.
  const crop = shape.props.crop;
  const fullW = crop ? shape.props.w / crop.w : shape.props.w;
  const fullH = crop ? shape.props.h / crop.h : shape.props.h;
  const full: Rect = {
    x: crop ? shape.x - crop.x * fullW : shape.x,
    y: crop ? shape.y - crop.y * fullH : shape.y,
    w: fullW,
    h: fullH,
  };

  const [rect, setRect] = useState<Rect>({
    x: shape.x,
    y: shape.y,
    w: shape.props.w,
    h: shape.props.h,
  });
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const fullRef = useRef(full);
  fullRef.current = full;

  const commit = () => {
    const r = rectRef.current;
    const f = fullRef.current;
    editor.updateShape(shape.id, {
      x: r.x,
      y: r.y,
      props: {
        w: r.w,
        h: r.h,
        crop: {
          x: (r.x - f.x) / f.w,
          y: (r.y - f.y) / f.h,
          w: r.w / f.w,
          h: r.h / f.h,
        },
      },
    });
    stop();
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  // Drag a handle (or the body, mode='move') to reshape the crop rect.
  const startDrag = (mode: HandleId | 'move') => (e: React.PointerEvent) => {
    e.stopPropagation();
    const startRect = rectRef.current;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: PointerEvent) => {
      const d = rotateVec(
        (ev.clientX - startX) / camera.z,
        (ev.clientY - startY) / camera.z,
        -shape.rotation,
      );
      const f = fullRef.current;
      if (mode === 'move') {
        setRect({
          ...startRect,
          x: clamp(startRect.x + d.x, f.x, f.x + f.w - startRect.w),
          y: clamp(startRect.y + d.y, f.y, f.y + f.h - startRect.h),
        });
        return;
      }
      let left = startRect.x;
      let top = startRect.y;
      let right = startRect.x + startRect.w;
      let bottom = startRect.y + startRect.h;
      if (mode.includes('w')) left = clamp(left + d.x, f.x, right - MIN);
      if (mode.includes('e')) right = clamp(right + d.x, left + MIN, f.x + f.w);
      if (mode.includes('n')) top = clamp(top + d.y, f.y, bottom - MIN);
      if (mode.includes('s')) bottom = clamp(bottom + d.y, top + MIN, f.y + f.h);
      setRect({ x: left, y: top, w: right - left, h: bottom - top });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Screen-space projection (rotation handled by the wrapping <g>).
  const fs = worldToScreen({ x: full.x, y: full.y }, camera);
  const rs = worldToScreen({ x: rect.x, y: rect.y }, camera);
  const z = camera.z;
  const fW = full.w * z;
  const fH = full.h * z;
  const rW = rect.w * z;
  const rH = rect.h * z;
  const pivot = worldToScreen(
    { x: shape.x + shape.props.w / 2, y: shape.y + shape.props.h / 2 },
    camera,
  );
  const deg = (shape.rotation * 180) / Math.PI;
  const href = blobUrl(shape.props.blobId);

  const handlePos = (id: HandleId) => {
    const cx =
      rs.x + (id.includes('w') ? 0 : id.includes('e') ? rW : rW / 2);
    const cy =
      rs.y + (id.includes('n') ? 0 : id.includes('s') ? rH : rH / 2);
    return { cx, cy };
  };

  return (
    <div
      className="absolute inset-0 z-[var(--z-canvas-front)]"
      style={{ cursor: 'default' }}
      onPointerDown={commit}
    >
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <clipPath id={`crop-rect-${shape.id}`}>
            <rect x={rs.x} y={rs.y} width={rW} height={rH} />
          </clipPath>
        </defs>
        <g transform={deg ? `rotate(${deg} ${pivot.x} ${pivot.y})` : undefined}>
          {/* Dimmed full image, then the crop region at full opacity. */}
          <image
            href={href}
            x={fs.x}
            y={fs.y}
            width={fW}
            height={fH}
            preserveAspectRatio="none"
            opacity={0.4}
          />
          <image
            href={href}
            x={fs.x}
            y={fs.y}
            width={fW}
            height={fH}
            preserveAspectRatio="none"
            clipPath={`url(#crop-rect-${shape.id})`}
          />
          {/* Crop rect: body is draggable to move the crop. */}
          <rect
            x={rs.x}
            y={rs.y}
            width={rW}
            height={rH}
            fill="transparent"
            stroke="var(--action-solid, #3b82f6)"
            strokeWidth={1.5}
            style={{ cursor: 'move' }}
            onPointerDown={startDrag('move')}
          />
          {HANDLES.map((id) => {
            const { cx, cy } = handlePos(id);
            return (
              <rect
                key={id}
                x={cx - 5}
                y={cy - 5}
                width={10}
                height={10}
                rx={2}
                fill="var(--background, var(--bg-canvas, #ffffff))"
                stroke="var(--action-solid, #3b82f6)"
                strokeWidth={1.5}
                style={{ cursor: CURSORS[id] }}
                onPointerDown={startDrag(id)}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
