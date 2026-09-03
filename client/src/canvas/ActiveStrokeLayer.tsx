import { useLayoutEffect, useRef } from 'react';
import { cameraToTransform, type Camera } from './camera';
import { inkPaint } from './ink-color';
import { isBelowPatternDetail, useDotLength } from './lod';
import { buildInkRender } from './shapes/draw';
import {
  getLiveStrokeFrame,
  setLiveStrokeSink,
  type LiveStrokeFrame,
} from './use-live-stroke-store';

/**
 * The stroke the local pointer is drawing, rendered outside React.
 *
 * Mounted only while a stroke is open, and only for that stroke's own author —
 * peers watch theirs arrive through the document like any other shape. The
 * canvas filters this shape out of the main tree for as long as this layer is
 * up, so exactly one of the two draws it at any moment.
 *
 * Its own `<svg>` rather than a group inside the shapes one: a live stroke
 * rewrites a path every frame, and doing that inside the element holding the
 * whole page makes the browser re-raster that layer. Here the churn is confined
 * to a single path and the page's raster survives the gesture untouched.
 */
export function ActiveStrokeLayer({ camera }: { camera: Camera }) {
  const groupRef = useRef<SVGGElement>(null);
  const inkRef = useRef<SVGPathElement>(null);
  // A dot is a zero-length dash, which browsers drop once the stroke is
  // sub-pixel wide. Discrete, so this only re-renders when the zoom crosses it.
  const dotLength = useDotLength();
  // The live stroke has to make the same simplification choice the committed
  // shape will, or the ink would visibly change character at pointer-up. Its
  // brush size is only known per frame, so the threshold is evaluated inside
  // `draw` against the zoom rather than read from a hook up here. Held in a ref
  // and refreshed on every render: the sink closure below outlives the camera
  // prop it was created with, and re-registering it per zoom frame would tear
  // the sink down and rebuild it in the middle of a pinch.
  const zoomRef = useRef(camera.z);
  useLayoutEffect(() => {
    zoomRef.current = camera.z;
  });

  useLayoutEffect(() => {
    const draw = (frame: LiveStrokeFrame) => {
      const group = groupRef.current;
      const ink = inkRef.current;
      if (!group || !ink) return;
      const points =
        frame.predicted.length > 0
          ? frame.points.concat(frame.predicted)
          : frame.points;
      if (points.length === 0) {
        ink.removeAttribute('d');
        return;
      }
      // Ink follows the viewer's theme here exactly as it will once the shape
      // is committed (`ShapeView`), or the stroke would change color under the
      // hand at pointer-up.
      const color = inkPaint(frame.props.color);
      const { size } = frame.props;
      // `isClosed` is only ever written by the tool's `finalize`, after this
      // layer is gone, so a live stroke is never filled — the ink is all there
      // is to draw.
      const render = buildInkRender(
        frame.props,
        points,
        true,
        dotLength,
        isBelowPatternDetail(zoomRef.current, size),
      );
      group.setAttribute(
        'transform',
        `translate(${frame.origin.x} ${frame.origin.y})`,
      );
      group.setAttribute('opacity', String(frame.opacity));
      ink.setAttribute('d', render.d);
      if (render.stroked) {
        ink.setAttribute('fill', 'none');
        ink.setAttribute('stroke', color);
        ink.setAttribute('stroke-width', String(size));
        setOrRemove(ink, 'stroke-dasharray', render.dash?.strokeDasharray);
        setOrRemove(ink, 'stroke-dashoffset', render.dash?.strokeDashoffset);
      } else {
        ink.setAttribute('fill', color);
        ink.removeAttribute('stroke');
        ink.removeAttribute('stroke-width');
        ink.removeAttribute('stroke-dasharray');
        ink.removeAttribute('stroke-dashoffset');
      }
    };
    const release = setLiveStrokeSink(draw);
    // The tool has been drawing since before this commit; catch up to it rather
    // than stay blank until the next pointer move.
    const pending = getLiveStrokeFrame();
    if (pending) draw(pending);
    return release;
  }, [dotLength]);

  return (
    <svg className="pointer-events-none absolute inset-0 z-[var(--z-canvas-shapes)] h-full w-full">
      <g transform={cameraToTransform(camera)}>
        {/* `d`, `fill`, `stroke`, `opacity`, the dash props and the inner
            transform are all written imperatively above. React must not be
            given any of them, or it would reset them to its own (empty) values
            on the next camera frame and blank the stroke mid-gesture. */}
        <g ref={groupRef}>
          <path ref={inkRef} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}

function setOrRemove(
  el: Element,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) el.removeAttribute(name);
  else el.setAttribute(name, value);
}
