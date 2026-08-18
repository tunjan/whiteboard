import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { Pencil } from 'lucide-react';
import { cn } from '../../src/lib/utils';
import '../../src/index.css';
import type { CursorVariantProps } from './cursor-types';
import { FootprintCursor } from './footprint-cursor';
import { NibCursor } from './nib-cursor';
import { PrecisionCursor } from './precision-cursor';
import './prototype.css';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  color: string;
  id: number;
  points: Point[];
  size: number;
}

interface CursorDirection {
  component: ComponentType<CursorVariantProps>;
  description: string;
  name: string;
}

const CURSOR_DIRECTIONS: readonly CursorDirection[] = [
  {
    name: 'Footprint',
    description: 'Shows the exact area the brush will cover.',
    component: FootprintCursor,
  },
  {
    name: 'Precision',
    description: 'Keeps the stroke origin visible for accurate joins.',
    component: PrecisionCursor,
  },
  {
    name: 'Nib',
    description: 'Uses a familiar pen silhouette with a true tip hotspot.',
    component: NibCursor,
  },
];

const COLORS = [
  { label: 'Black', value: '#1d1d1d' },
  { label: 'Blue', value: '#4465e9' },
  { label: 'Red', value: '#e03131' },
  { label: 'Green', value: '#099268' },
] as const;

const SIZES = [
  { label: 'S', value: 2 },
  { label: 'M', value: 4 },
  { label: 'L', value: 8 },
  { label: 'XL', value: 16 },
] as const;

function initialVariant(): number {
  const requested = Number(
    new URLSearchParams(window.location.search).get('v'),
  );
  return Number.isInteger(requested) &&
    requested >= 1 &&
    requested <= CURSOR_DIRECTIONS.length
    ? requested - 1
    : 0;
}

function pointFromEvent(
  event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  element: HTMLElement,
): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function strokePath(points: Point[]): string {
  const first = points[0];
  if (!first) return '';
  if (points.length === 1) return `M ${first.x} ${first.y} l 0.01 0`;
  return points.reduce(
    (path, point, index) =>
      index === 0
        ? `M ${point.x} ${point.y}`
        : `${path} L ${point.x} ${point.y}`,
    '',
  );
}

function PrototypePicker({
  active,
  onChange,
}: {
  active: number;
  onChange: (index: number) => void;
}) {
  const pickerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveHighlight = useCallback(() => {
    const item = itemRefs.current[active];
    const highlight = highlightRef.current;
    if (!item || !highlight) return;
    highlight.style.width = `${item.offsetWidth}px`;
    highlight.style.transform = `translateX(${item.offsetLeft}px)`;
  }, [active]);

  useLayoutEffect(moveHighlight, [moveHighlight]);

  useEffect(() => {
    window.addEventListener('resize', moveHighlight);
    const firstFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        pickerRef.current?.setAttribute('data-ready', '');
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.removeEventListener('resize', moveHighlight);
    };
  }, [moveHighlight]);

  return (
    <nav
      ref={pickerRef}
      className="proto-picker"
      aria-label="Prototype variants"
      data-position="top"
    >
      <span
        ref={highlightRef}
        className="proto-picker-highlight"
        aria-hidden="true"
      />
      {CURSOR_DIRECTIONS.map((direction, index) => (
        <button
          key={direction.name}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          className="proto-picker-item"
          data-active={index === active ? '' : undefined}
          aria-current={index === active ? 'true' : undefined}
          onClick={() => onChange(index)}
        >
          {direction.name}
        </button>
      ))}
    </nav>
  );
}

function DrawingCursorPrototype() {
  const [activeVariant, setActiveVariant] = useState(initialVariant);
  const [color, setColor] =
    useState<(typeof COLORS)[number]['value']>('#4465e9');
  const [brushSize, setBrushSize] = useState(8);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<number | null>(null);
  const nextStrokeIdRef = useRef(1);

  const selectVariant = useCallback((index: number) => {
    if (index < 0 || index >= CURSOR_DIRECTIONS.length) return;
    setActiveVariant(index);
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(index + 1));
    window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const number = Number.parseInt(event.key, 10);
      if (number >= 1 && number <= CURSOR_DIRECTIONS.length) {
        selectVariant(number - 1);
      } else if (event.key === 'ArrowRight') {
        selectVariant((activeVariant + 1) % CURSOR_DIRECTIONS.length);
      } else if (event.key === 'ArrowLeft') {
        selectVariant(
          (activeVariant - 1 + CURSOR_DIRECTIONS.length) %
            CURSOR_DIRECTIONS.length,
        );
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeVariant, selectVariant]);

  const positionCursor = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const stage = stageRef.current;
      const cursor = cursorRef.current;
      if (!stage || !cursor || event.pointerType === 'touch') {
        if (cursor) cursor.style.opacity = '0';
        return;
      }

      const point = pointFromEvent(event.nativeEvent, stage);
      cursor.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
      cursor.style.opacity = '1';
    },
    [],
  );

  const finishStroke = useCallback((pointerId: number) => {
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
    activeStrokeRef.current = null;
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    positionCursor(event);
    if (event.button !== 0) return;

    const stage = stageRef.current;
    if (!stage) return;
    const id = nextStrokeIdRef.current++;
    activePointerRef.current = event.pointerId;
    activeStrokeRef.current = id;
    event.currentTarget.setPointerCapture(event.pointerId);
    setStrokes((current) => [
      ...current,
      {
        id,
        color,
        size: brushSize,
        points: [pointFromEvent(event.nativeEvent, stage)],
      },
    ]);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    positionCursor(event);
    if (activePointerRef.current !== event.pointerId) return;

    const stage = stageRef.current;
    const strokeId = activeStrokeRef.current;
    if (!stage || strokeId === null) return;
    const coalesced = event.nativeEvent.getCoalescedEvents?.();
    const samples =
      coalesced && coalesced.length > 0 ? coalesced : [event.nativeEvent];
    const points = samples.map((sample) => pointFromEvent(sample, stage));
    setStrokes((current) =>
      current.map((stroke) =>
        stroke.id === strokeId
          ? { ...stroke, points: [...stroke.points, ...points] }
          : stroke,
      ),
    );
  };

  const ActiveCursor = CURSOR_DIRECTIONS[activeVariant]!.component;
  const activeDirection = CURSOR_DIRECTIONS[activeVariant]!;

  return (
    <main className="relative h-dvh overflow-hidden bg-surface text-primary">
      <div
        ref={stageRef}
        role="region"
        aria-label="Cursor testing canvas"
        className="absolute inset-0 cursor-none touch-none overflow-hidden"
        onPointerEnter={positionCursor}
        onPointerLeave={() => {
          if (cursorRef.current) cursorRef.current.style.opacity = '0';
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishStroke(event.pointerId)}
        onPointerCancel={(event) => finishStroke(event.pointerId)}
        onLostPointerCapture={(event) => finishStroke(event.pointerId)}
      >
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          aria-hidden="true"
          shapeRendering="auto"
        >
          <defs>
            <pattern
              id="prototype-dot-grid"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx="1"
                cy="1"
                r="1"
                fill="var(--grid-dot)"
                opacity="0.55"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#prototype-dot-grid)" />
          <g opacity="0.7">
            <path
              d="M164 238 C230 174 310 186 366 246 S493 306 554 235"
              fill="none"
              stroke="#4465e9"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              d="M655 220 h170 v104 h-170 z"
              fill="none"
              stroke="var(--color-border-strong)"
              strokeWidth="2"
              strokeDasharray="8 7"
            />
            <path
              d="M690 286 C725 251 768 252 798 281"
              fill="none"
              stroke="#099268"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </g>
          {strokes.map((stroke) => (
            <path
              key={stroke.id}
              data-prototype-stroke
              d={strokePath(stroke.points)}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.size}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        <ActiveCursor
          key={activeVariant}
          brushSize={brushSize}
          color={color}
          cursorRef={cursorRef}
        />
      </div>

      <section
        data-ui-layer
        className="pointer-events-auto absolute top-6 left-6 z-[var(--z-ui)] max-w-64 rounded-xl border border-border bg-panel p-4 shadow-sm"
      >
        <p className="text-sm font-semibold text-balance">Cursor study</p>
        <p className="mt-1 text-xs text-secondary text-pretty">
          {activeDirection.description} Draw on the board, then switch with 1–3
          or the arrow keys.
        </p>
      </section>

      <div
        data-ui-layer
        className="pointer-events-auto absolute left-1/2 z-[var(--z-ui)] flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-panel p-2 shadow-sm"
        style={{ bottom: 'max(24px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex h-9 items-center gap-2 rounded-lg bg-blue-100 px-3 text-xs font-medium text-blue-700">
          <Pencil className="size-4" aria-hidden="true" />
          Draw
        </div>

        <span className="h-6 w-px bg-border" aria-hidden="true" />

        <div className="flex items-center gap-1" aria-label="Ink color">
          {COLORS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={`${option.label} ink`}
              aria-pressed={color === option.value}
              className={cn(
                'grid size-8 place-items-center rounded-lg border bg-surface',
                color === option.value
                  ? 'border-foreground'
                  : 'border-transparent',
              )}
              onClick={() => setColor(option.value)}
            >
              <span
                className="size-4 rounded-full border border-black/10"
                style={{ backgroundColor: option.value }}
              />
            </button>
          ))}
        </div>

        <span className="h-6 w-px bg-border" aria-hidden="true" />

        <div className="flex items-center gap-1" aria-label="Brush size">
          {SIZES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={brushSize === option.value}
              className={cn(
                'size-8 rounded-lg text-xs font-medium tabular-nums',
                brushSize === option.value
                  ? 'bg-inverse text-fg-inverse'
                  : 'text-secondary hover:bg-surface',
              )}
              onClick={() => setBrushSize(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="h-6 w-px bg-border" aria-hidden="true" />

        <button
          type="button"
          className="h-8 rounded-lg px-3 text-xs font-medium text-secondary hover:bg-surface hover:text-primary"
          onClick={() => setStrokes([])}
        >
          Clear
        </button>
      </div>

      <PrototypePicker active={activeVariant} onChange={selectVariant} />
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);

root.render(
  <StrictMode>
    <DrawingCursorPrototype />
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => root.unmount());
}
