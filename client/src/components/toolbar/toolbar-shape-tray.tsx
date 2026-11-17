import type { PolygonKind } from '@whiteboard/shared';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { MiniShape, polygonLabel } from './toolbar-constants';
import { KeyTip } from './toolbar-primitives';
import { arrowDelta, Segmented, TrayMenu } from './toolbar-tray-controls';

type TrayShape = { id: string; label: string; polygon?: PolygonKind };

const trayPolygon = (kind: PolygonKind): TrayShape => ({
  id: kind,
  label: polygonLabel(kind),
  polygon: kind,
});

/** The reference tray's nine, in its order. */
const TRAY_SHAPES: TrayShape[] = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  ...(
    ['triangle', 'diamond', 'parallelogram', 'trapezoid', 'hexagon', 'cloud', 'star'] as const
  ).map(trayPolygon),
];

/** The rest of what the Shapes key draws, behind More shapes. */
const MORE_SHAPES: TrayShape[] = [trayPolygon('pentagon'), { id: 'line', label: 'Line' }];

function TrayShapeGlyph({
  id,
  polygon,
  size = 28,
}: {
  id: string;
  polygon?: PolygonKind;
  size?: number;
}) {
  if (polygon) return <MiniShape kind={polygon} size={size} strokeWidth={1.2} />;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
        {id === 'rectangle' ? <rect x="2" y="2" width="12" height="12" rx="0.5" /> : null}
        {id === 'ellipse' ? <circle cx="8" cy="8" r="6" /> : null}
        {id === 'line' ? <path d="M2.5 13.5 13.5 2.5" /> : null}
      </g>
    </svg>
  );
}

function TrayShapeCell({
  shape,
  checked,
  onPick,
}: {
  shape: TrayShape;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={shape.label}
            tabIndex={checked ? 0 : -1}
            onClick={onPick}
            className="tray-cell"
          />
        }
      >
        <TrayShapeGlyph id={shape.id} polygon={shape.polygon} />
      </TooltipTrigger>
      <KeyTip label={shape.label} />
    </Tooltip>
  );
}

function pickShape(shape: TrayShape) {
  if (shape.polygon) useStyleStore.getState().setPolygonKind(shape.polygon);
  useToolStore.getState().setTool(shape.polygon ? 'polygon' : shape.id);
}

/** The shapes under a bottom bar: one row, the shape in hand shaded. */
export function ShapeTray({
  activeToolId,
  barVisible,
  compact,
}: {
  activeToolId: string;
  barVisible: boolean;
  /** Under the narrow bar: every shape behind one key showing the current. */
  compact: boolean;
}) {
  const polygonKind = useStyleStore((s) => s.polygonKind);
  const current = activeToolId === 'polygon' ? polygonKind : activeToolId;
  if (compact) {
    const all = [...TRAY_SHAPES, ...MORE_SHAPES];
    const shown = all.find((shape) => shape.id === current) ?? all[0]!;
    return (
      <TrayMenu
        label={`Shape, ${shown.label}`}
        barVisible={barVisible}
        value={<TrayShapeGlyph id={shown.id} polygon={shown.polygon} />}
      >
        {(close) => (
          <div role="radiogroup" aria-label="Shape" className="tray-grid">
            {all.map((shape) => (
              <TrayShapeCell
                key={shape.id}
                shape={shape}
                checked={shape.id === current}
                onPick={() => {
                  pickShape(shape);
                  close();
                }}
              />
            ))}
          </div>
        )}
      </TrayMenu>
    );
  }
  const pick = (index: number) => pickShape(TRAY_SHAPES[index]!);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const index = TRAY_SHAPES.findIndex((shape) => shape.id === current);
    pick((index + delta + TRAY_SHAPES.length) % TRAY_SHAPES.length);
    // React clears `currentTarget` once the handler returns.
    const group = event.currentTarget;
    requestAnimationFrame(() =>
      group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
    );
  };
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Shape"
        onKeyDown={onKeyDown}
        className="tray-shapes"
      >
        {TRAY_SHAPES.map((shape, i) => (
          <TrayShapeCell
            key={shape.id}
            shape={shape}
            checked={shape.id === current}
            onPick={() => pick(i)}
          />
        ))}
      </div>
      <TrayMenu
        label="More shapes"
        barVisible={barVisible}
        checked={MORE_SHAPES.some((shape) => shape.id === current)}
        value={<span className="tray-value">More shapes</span>}
      >
        {(close) => (
          <Segmented
            label="More shapes"
            labelled
            options={MORE_SHAPES.map((shape) => ({
              value: shape.id,
              label: shape.label,
              text: shape.label,
              glyph: <TrayShapeGlyph id={shape.id} polygon={shape.polygon} size={18} />,
            }))}
            value={current}
            onSelect={(id) => {
              pickShape(MORE_SHAPES.find((shape) => shape.id === id)!);
              close();
            }}
          />
        )}
      </TrayMenu>
    </>
  );
}
