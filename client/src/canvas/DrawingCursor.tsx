import { useEffect, useRef, type RefObject } from 'react';
import { useHoverCursor } from '@/hooks/use-hover-cursor';
import { inkPaint } from './ink-color';
import { STROKE_PROFILES, inkRadiusAt } from './shapes/ink';
import { highlightPaint } from './shapes/highlight';
import { MARKER_SIZE_SCALE, pencilNib, type InkKind } from './tools/draw-tool';
import { useCameraStore } from './use-camera-store';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { useStyleStore } from './use-style-store';

/**
 * Pencil barrel in the viewBox below: a square point at the lower left, sides
 * running up at 45 degrees, a rounded eraser at the upper right.
 */
const PENCIL_BODY =
  'M 4 20 L 4 15.19 L 15.6 3.6 Q 17.15 2.04 18.71 3.6 L 20.4 5.29 Q 21.96 6.85 20.4 8.4 L 8.81 20 Z';
/**
 * Where the sharpened point meets the barrel. It sits further up than the
 * silhouette's corner needs, which lengthens the point into a wedge big enough
 * to read as a block of colour at cursor size.
 */
const PENCIL_LEAD = 'M 6.69 12.5 L 11.5 17.31';
/** The metal band holding the eraser. */
const PENCIL_FERRULE = 'M 13.26 5.93 L 18.07 10.74';
/** The sharpened point, filled with the current colour. */
const PENCIL_INK =
  'M 4 20 L 4 15.19 L 6.69 12.5 L 11.5 17.31 L 8.81 20 Z';

const VIEWBOX = 24;
const PENCIL_PX = 28;
const STROKE = 1.1;
/** Where the pencil meets the page, in viewBox units — this is the hotspot. */
const PENCIL_POINT = { x: 4, y: 20 };

/**
 * Smallest on-screen pen width the footprint ring is drawn for at rest. Below
 * it the ring sits inside the pencil's own point and only adds noise; the
 * point already says where the ink lands.
 */
const FOOTPRINT_MIN_PX = 6;
/** How long a size or colour change shows the footprint whatever its size. */
const FOOTPRINT_FLASH_MS = 700;
/** How much of the wash the highlighter's footprint previews. */
const MARKER_PREVIEW_ALPHA = 45;

interface DrawingCursorProps {
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * Which ink the cursor previews. Given, it adds the brush footprint, and the
   * marker swaps the pencil for that footprint alone. Left out — the loading
   * veil's decorative pencil — there is no camera to size a footprint against.
   */
  ink?: InkKind;
}

/** A pencil that follows mouse and pen hover without re-rendering. */
export function DrawingCursor({ containerRef, ink }: DrawingCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const color = useStyleStore((state) => state.color);

  useHoverCursor(containerRef, cursorRef);

  if (ink === 'marker') {
    return (
      <div
        ref={cursorRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-front)] size-0 opacity-0 will-change-transform"
      >
        <Footprint containerRef={containerRef} ink={ink} color={color} />
      </div>
    );
  }

  return (
    // The wrapper has no size, so the hover hook's centring translate lands its
    // origin exactly on the pointer; the pencil then hangs off that origin by
    // its point, which is where the stroke actually comes out.
    <div
      ref={cursorRef}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0 z-[var(--z-canvas-front)] size-0 opacity-0 will-change-transform"
    >
      {ink && <Footprint containerRef={containerRef} ink={ink} color={color} />}
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        width={PENCIL_PX}
        height={PENCIL_PX}
        className="absolute"
        style={{
          left: -(PENCIL_POINT.x / VIEWBOX) * PENCIL_PX,
          top: -(PENCIL_POINT.y / VIEWBOX) * PENCIL_PX,
        }}
      >
        {/* White body over a black outline, fixed rather than themed: the
            pencil sits on top of the drawing, so it has to stay legible over
            whatever ink is underneath it rather than over the canvas colour.
            Stroking the fill in white widens it into a rim past the outline. */}
        <path
          d={PENCIL_BODY}
          strokeWidth={STROKE + 1.7}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="fill-white stroke-white"
        />
        <path d={PENCIL_INK} fill={color} />
        <g
          fill="none"
          strokeWidth={STROKE}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-black"
        >
          <path d={PENCIL_BODY} />
          <path d={PENCIL_LEAD} />
          <path d={PENCIL_FERRULE} />
        </g>
      </svg>
    </div>
  );
}

interface FootprintProps {
  containerRef: RefObject<HTMLDivElement | null>;
  ink: InkKind;
  color: string;
}

/**
 * The width of ink a press would lay down here, centred on the hotspot.
 *
 * Sized from the brush and the live camera, so it is what the stroke will
 * really measure on screen at this zoom. The camera is followed imperatively —
 * a zoom gesture must not re-render anything — and snaps; a size change eases,
 * so stepping with [ and ] is seen happening at the point being looked at.
 * Hidden while pressed: from then on the ink itself is the preview.
 */
function Footprint({ containerRef, ink, color }: FootprintProps) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useStyleStore((state) => state.size);
  const simulatePressure = useCanvasUiStore((s) => s.pencilSimulatePressure);
  const thinning = useCanvasUiStore((s) => s.pencilThinning);
  const curve = useCanvasUiStore((s) => s.pencilPressureCurve);
  const state = useRef({
    small: false,
    flash: false,
    pressed: false,
    mounted: false,
    stylus: false,
  });

  const refresh = () => {
    const el = ref.current;
    if (!el) return;
    const { small, flash, pressed } = state.current;
    el.style.opacity = !pressed && (flash || !small) ? '1' : '0';
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The pencil previews the nib the draw tool will build for this input, at
    // the neutral pressure a stroke opens on: a stylus and a speed-driven mouse
    // both draw wider than the bare style size.
    const world = (): number => {
      if (ink === 'marker') {
        return STROKE_PROFILES.highlight(size * MARKER_SIZE_SCALE).size;
      }
      const { stylus } = state.current;
      const velocity = !stylus && simulatePressure;
      const nib = pencilNib(size, stylus, velocity, {
        pencilThinning: thinning,
        pencilPressureCurve: curve,
      });
      return (
        2 *
        inkRadiusAt(
          nib.profile.size,
          {
            thinning: nib.thinning,
            pressureEasing: nib.pressureEasing,
            simulatePressure: velocity,
          },
          0.5,
        )
      );
    };
    const apply = (animate: boolean) => {
      const diameter = world() * useCameraStore.getState().camera.z;
      el.style.transition = animate ? '' : 'none';
      el.style.setProperty('--d', `${diameter}px`);
      state.current.small = ink === 'pencil' && diameter < FOOTPRINT_MIN_PX;
      refresh();
    };
    apply(state.current.mounted);
    const container = containerRef.current;
    const hover = (event: PointerEvent) => {
      const stylus = event.pointerType === 'pen';
      if (stylus === state.current.stylus) return;
      state.current.stylus = stylus;
      apply(false);
    };
    container?.addEventListener('pointermove', hover, { passive: true });
    const unsubscribe = useCameraStore.subscribe((next, previous) => {
      if (next.camera.z !== previous.camera.z) apply(false);
    });
    return () => {
      container?.removeEventListener('pointermove', hover);
      unsubscribe();
    };
  }, [containerRef, ink, size, simulatePressure, thinning, curve]);

  // Flash on a change of brush, not on the cursor first appearing.
  useEffect(() => {
    if (!state.current.mounted) {
      state.current.mounted = true;
      return;
    }
    state.current.flash = true;
    refresh();
    const timer = setTimeout(() => {
      state.current.flash = false;
      refresh();
    }, FOOTPRINT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [size, color]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const press = (event: PointerEvent) => {
      if (event.button !== 0) return;
      state.current.pressed = true;
      refresh();
    };
    const release = () => {
      state.current.pressed = false;
      refresh();
    };
    container.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    return () => {
      container.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [containerRef]);

  return (
    <div
      ref={ref}
      className="absolute rounded-full opacity-0 transition-[width,height,left,top,opacity] duration-150 ease-out"
      style={{
        width: 'var(--d)',
        height: 'var(--d)',
        left: 'calc(var(--d) / -2)',
        top: 'calc(var(--d) / -2)',
        // A white hairline outside a dark one, like the pencil's rim, so the
        // ring reads over the ink it is about to cross whatever its colour.
        boxShadow:
          'inset 0 0 0 1px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.85)',
        backgroundColor:
          ink === 'marker'
            ? `color-mix(in srgb, ${highlightPaint(inkPaint(color))} ${MARKER_PREVIEW_ALPHA}%, transparent)`
            : undefined,
      }}
    />
  );
}
