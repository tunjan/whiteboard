import { Fragment, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Minus, MoveHorizontal } from 'lucide-react';
import type {
  ArrowTopology,
  FillStyle,
  FontFamily,
  LineSpline,
  StrokeDash,
} from '@whiteboard/shared';
import { fontStack } from '@/canvas/shapes/text-measure';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import type { StyleControls, StyleFlags } from '@/canvas/use-style-controls';
import { SIZE_OPTIONS } from '@/canvas/use-style-store';
import { OpacitySlider } from '@/components/opacity-slider';
import {
  ALIGNS,
  ARROW_TOPOLOGIES,
  DASH_LABELS,
  ERASER_MODES,
  FILLS,
  FILL_LABELS,
  FONTS,
  FillPreview,
  SPLINES,
  SPLINE_LABELS,
  SplinePreview,
  WEIGHTS,
} from '@/components/style-previews';
import { Input } from '@/components/ui/input';
import { Segmented, TrayCells } from './toolbar-tray-controls';

/** Sample-stroke thickness for each weight, at chrome scale. */
export const WEIGHT_STROKES = [2, 4, 7, 11];

const WEIGHT_NAMES: Record<string, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

const FONT_NAMES: Record<FontFamily, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
  hand: 'Handwritten',
};

/** Each route drawn as the path it takes, at the Stroke row's size. */
const ROUTE_PATHS: Record<ArrowTopology, string> = {
  straight: 'M4 11 L18 1',
  arc: 'M2 9 Q11 -1 20 9',
  elbow: 'M2 3 V9 H20',
};

function RoutePreview({ route }: { route: ArrowTopology }) {
  return (
    <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
      <path
        d={ROUTE_PATHS[route]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The stroke row's order and names: the pen's own line first. */
const TRAY_DASHES: StrokeDash[] = ['draw', 'dashed', 'dotted', 'solid'];
const DASH_NAMES: Record<StrokeDash, string> = {
  draw: 'Drawn',
  dashed: 'Dashed',
  dotted: 'Dotted',
  solid: 'Solid',
};

/** The tray menus' visible names: one word each, like the stroke row's. */
const FILL_NAMES: Record<FillStyle, string> = {
  none: 'None',
  solid: 'Solid',
  hatch: 'Hatched',
  crosshatch: 'Crosshatch',
};
const SPLINE_NAMES: Record<LineSpline, string> = {
  linear: 'Straight',
  smooth: 'Smooth',
};

/** A stroke drawn on the diagonal: the tray key shows the one in use. */
function StrokeGlyph({ dash }: { dash: StrokeDash }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tray-stroke">
      {dash === 'draw' ? (
        // A freehand scribble, where the others are ruled.
        <path
          d="M3.5 16 C5.5 8 8 6.5 9.5 10 C11 13.5 9.6 18 11.6 18.5 C14 19 14.6 12 16.4 10.2 C17.6 9 19 10 20.5 7"
          strokeWidth={2}
        />
      ) : (
        <path
          d="M5 19 19 5"
          strokeWidth={2}
          strokeDasharray={dash === 'dashed' ? '3.5 4' : dash === 'dotted' ? '0 4' : undefined}
        />
      )}
    </svg>
  );
}

/** A square turning to a transparency check, so a percentage reads as opacity. */
function OpacityGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="tray-glyph">
      <rect x={2.5} y={2.5} width={11} height={11} rx={1.5} fill="none" stroke="currentColor" strokeWidth={1} />
      <path d="M8 2.5h2.75v2.75H8zM10.75 5.25h2.75V8h-2.75zM8 8h2.75v2.75H8zM10.75 10.75h2.75v2.75h-2.75z" fill="currentColor" />
    </svg>
  );
}

type Ends = 'none' | 'start' | 'end' | 'both';

/** Each route at tray scale, with where it leaves and arrives and which way
 *  it is heading there, so a head can sit on either end. A straight route runs
 *  on the diagonal, and only the ends row is level, so the two rows never
 *  draw the same glyph. */
const ROUTES: Record<
  ArrowTopology | 'level',
  { d: string; start: [number, number, number, number]; end: [number, number, number, number] }
> = {
  straight: { d: 'M5 19L19 5', start: [5, 19, -0.71, 0.71], end: [19, 5, 0.71, -0.71] },
  arc: { d: 'M4 17Q12 1 20 17', start: [4, 17, -0.5, 0.87], end: [20, 17, 0.5, 0.87] },
  elbow: { d: 'M5 5V18H20', start: [5, 5, 0, -1], end: [20, 18, 1, 0] },
  level: { d: 'M4 12H20', start: [4, 12, -1, 0], end: [20, 12, 1, 0] },
};

/** An open arrowhead: two strokes back from the tip, 35° either side. */
function head([x, y, dx, dy]: [number, number, number, number]): string {
  const wing = (turn: number) => {
    const c = Math.cos(turn);
    const t = Math.sin(turn);
    return `${x - 5 * (dx * c - dy * t)} ${y - 5 * (dx * t + dy * c)}`;
  };
  return `M${wing(0.6)}L${x} ${y}L${wing(-0.6)}`;
}

/** An arrow drawn the way it will be laid down: its route, with its heads. */
function ArrowGlyph({
  route,
  ends,
}: {
  route: keyof typeof ROUTES;
  ends: Ends;
}) {
  const { d, start, end } = ROUTES[route];
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d={`${d}${ends === 'start' || ends === 'both' ? head(start) : ''}${
          ends === 'end' || ends === 'both' ? head(end) : ''
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** One setting: its controls, and what the tray's menu key shows of it. */
export interface Section {
  key: string;
  label: string;
  value: ReactNode;
  node: ReactNode;
  /** In the tray, shown in the open instead of behind a menu. */
  open?: boolean;
}

const ENDS: { value: Ends; label: string; glyph: ReactNode }[] = [
  { value: 'none', label: 'No arrowheads', glyph: <Minus size={16} /> },
  { value: 'start', label: 'Arrowhead at start', glyph: <ArrowLeft size={16} /> },
  { value: 'end', label: 'Arrowhead at end', glyph: <ArrowRight size={16} /> },
  { value: 'both', label: 'Arrowheads at both ends', glyph: <MoveHorizontal size={16} /> },
];

export function EraserMode() {
  const eraserMode = useCanvasUiStore((s) => s.eraserMode);
  const setEraserMode = useCanvasUiStore((s) => s.setEraserMode);
  return (
    <Segmented
      label="Eraser mode"
      tooltips
      options={ERASER_MODES.map(({ mode, label, Preview }) => ({
        value: mode,
        label,
        glyph: <Preview />,
      }))}
      value={eraserMode}
      onSelect={setEraserMode}
    />
  );
}

/** The stroke weights, each drawn as a sample stroke. */
export function WeightRow({
  value,
  onSelect,
  inTray,
}: {
  value: number;
  onSelect: (value: number) => void;
  inTray: boolean;
}) {
  return (
    <Segmented
      label="Stroke weight"
      labelled={inTray}
      tooltips={!inTray}
      options={SIZE_OPTIONS.map((option, i) => ({
        value: option.value,
        label: WEIGHT_NAMES[option.name] ?? option.name,
        text: WEIGHT_NAMES[option.name] ?? option.name,
        glyph: (
          <span
            aria-hidden="true"
            className="tbar-weight"
            style={{ height: WEIGHT_STROKES[i] ?? 2 }}
          />
        ),
      }))}
      value={value}
      onSelect={onSelect}
    />
  );
}

/** The settings that apply, in the order the second row shows them. */
export function styleSections(
  on: StyleFlags,
  { values, apply }: Pick<StyleControls, 'values' | 'apply'>,
  inTray: boolean,
): Section[] {
  const ends: Ends =
    values.arrowStart && values.arrowEnd
      ? 'both'
      : values.arrowStart
        ? 'start'
        : values.arrowEnd
          ? 'end'
          : 'none';
  const setEnds = (next: Ends) => {
    apply.arrowStart(next === 'start' || next === 'both');
    apply.arrowEnd(next === 'end' || next === 'both');
  };
  // With no heads a route is drawn as a line, so it is named as one.
  const routeLabel = (label: string) =>
    ends === 'none' ? label.replace('arrow', 'line') : label;

  const sections: Section[] = [];
  if (on.font && inTray) {
    sections.push({
      key: 'font',
      label: 'Font',
      value: (
        <span className="tray-font" style={{ fontFamily: fontStack(values.fontFamily) }}>
          Aa
        </span>
      ),
      node: (
        <TrayCells
          key="font"
          label="Font"
          options={FONTS.map(({ family, label }) => ({
            value: family,
            label: FONT_NAMES[family],
            glyph: <span className="tray-font">{label}</span>,
            style: { fontFamily: fontStack(family) },
          }))}
          value={values.fontFamily}
          onSelect={apply.fontFamily}
        />
      ),
    });
    const weight = WEIGHTS.find((option) => option.weight === values.fontWeight);
    sections.push({
      key: 'weight',
      label: 'Weight',
      value: (
        <span className="tray-value" style={{ fontWeight: values.fontWeight }}>
          {weight?.label}
        </span>
      ),
      node: (
        <Segmented
          key="weight"
          label="Weight"
          labelled
          options={WEIGHTS.map(({ weight, label }) => ({
            value: weight,
            label,
            text: label,
            glyph: null,
            style: { fontWeight: weight },
          }))}
          value={values.fontWeight}
          onSelect={apply.fontWeight}
        />
      ),
    });
  } else if (on.font) {
    sections.push({
      key: 'font',
      label: 'Font',
      value: (
        <span className="tray-value" style={{ fontFamily: fontStack(values.fontFamily) }}>
          Aa
        </span>
      ),
      node: (
        <Fragment key="font">
          <Segmented
            label="Font"
            tooltips
            options={FONTS.map(({ family, label }) => ({
              value: family,
              label: FONT_NAMES[family],
              glyph: label,
              style: { fontFamily: fontStack(family) },
            }))}
            value={values.fontFamily}
            onSelect={apply.fontFamily}
          />
          <Segmented
            label="Weight"
            tooltips
            options={WEIGHTS.map(({ weight, label }) => ({
              value: weight,
              label,
              glyph: 'A',
              style: {
                fontFamily: fontStack(values.fontFamily),
                fontWeight: weight,
              },
            }))}
            value={values.fontWeight}
            onSelect={apply.fontWeight}
          />
        </Fragment>
      ),
    });
  }
  if (on.align) {
    const Align = ALIGNS.find((option) => option.align === values.align)?.Icon;
    sections.push({
      key: 'align',
      label: 'Align',
      value: Align ? <Align aria-hidden="true" /> : null,
      node: inTray ? (
        <TrayCells
          key="align"
          label="Align"
          options={ALIGNS.map(({ align, Icon }) => ({
            value: align,
            label: { start: 'Left', middle: 'Center', end: 'Right' }[align],
            glyph: <Icon aria-hidden="true" className="tray-glyph" />,
          }))}
          value={values.align}
          onSelect={apply.align}
        />
      ) : (
        <Segmented
          key="align"
          label="Align"
          tooltips
          options={ALIGNS.map(({ align, Icon }) => ({
            value: align,
            label: { start: 'Left', middle: 'Center', end: 'Right' }[align],
            glyph: <Icon aria-hidden="true" />,
          }))}
          value={values.align}
          onSelect={apply.align}
        />
      ),
    });
  }
  if (on.arrows) {
    sections.push({
      key: 'arrows',
      label: 'Arrow',
      value: inTray ? (
        <ArrowGlyph route={values.arrowTopology} ends={ends} />
      ) : (
        <RoutePreview route={values.arrowTopology} />
      ),
      open: inTray,
      node: inTray ? (
        <Fragment key="arrows">
          <TrayCells
            label="Route"
            options={ARROW_TOPOLOGIES.map((option) => ({
              value: option.value,
              label: routeLabel(option.label),
              glyph: <ArrowGlyph route={option.value} ends={ends} />,
            }))}
            value={values.arrowTopology}
            onSelect={apply.arrowTopology}
          />
          <TrayCells
            label="Ends"
            options={ENDS.map((option) => ({
              ...option,
              glyph: <ArrowGlyph route="level" ends={option.value} />,
            }))}
            value={ends}
            onSelect={setEnds}
          />
        </Fragment>
      ) : (
        <Fragment key="arrows">
          <Segmented
            label="Route"
            tooltips
            options={ARROW_TOPOLOGIES.map((option) => ({
              value: option.value,
              label: routeLabel(option.label),
              glyph: <RoutePreview route={option.value} />,
            }))}
            value={values.arrowTopology}
            onSelect={apply.arrowTopology}
          />
          <Segmented
            label="Ends"
            tooltips
            options={ENDS}
            value={ends}
            onSelect={setEnds}
          />
        </Fragment>
      ),
    });
  }
  if (on.lineOptions) {
    sections.push({
      key: 'curve',
      label: 'Curve',
      value: <SplinePreview spline={values.lineSpline} />,
      node: (
        <Segmented
          key="curve"
          label="Curve"
          labelled={inTray}
          tooltips={!inTray}
          options={SPLINES.map((spline) => ({
            value: spline,
            label: SPLINE_LABELS[spline],
            text: SPLINE_NAMES[spline],
            glyph: <SplinePreview spline={spline} />,
          }))}
          value={values.lineSpline}
          onSelect={apply.lineSpline}
        />
      ),
    });
  }
  if (on.fill) {
    sections.push({
      key: 'fill',
      label: 'Fill',
      value: <FillPreview style={values.fill} color={values.color} className="tray-glyph" />,
      node: (
        <Segmented
          key="fill"
          label="Fill"
          labelled={inTray}
          tooltips={!inTray}
          options={FILLS.map((fillStyle) => ({
            value: fillStyle,
            label: FILL_LABELS[fillStyle],
            text: FILL_NAMES[fillStyle],
            glyph: <FillPreview style={fillStyle} color={values.color} />,
          }))}
          value={values.fill}
          onSelect={apply.fill}
        />
      ),
    });
  }
  if (on.dash) {
    sections.push({
      key: 'stroke',
      label: 'Stroke',
      value: <StrokeGlyph dash={values.dash} />,
      node: (
        <Segmented
          key="stroke"
          label="Stroke"
          labelled={inTray}
          tooltips={!inTray}
          options={TRAY_DASHES.map((dash) => ({
            value: dash,
            label: DASH_LABELS[dash],
            text: DASH_NAMES[dash],
            glyph: <StrokeGlyph dash={dash} />,
          }))}
          value={values.dash}
          onSelect={apply.dash}
        />
      ),
    });
  }
  if (on.opacity) {
    sections.push({
      key: 'opacity',
      label: 'Opacity',
      value: (
        <>
          <OpacityGlyph />
          <span className="tray-value tray-percent">{Math.round(values.opacity * 100)}%</span>
        </>
      ),
      node: (
        <div key="opacity" className="tbar-opacity">
          <OpacitySlider
            aria-label="Opacity"
            value={values.opacity}
            onValueChange={apply.opacity}
          />
        </div>
      ),
    });
  }
  if (on.connectorLabel) {
    sections.push({
      key: 'label',
      label: 'Label',
      value: <span className="tray-value">Label</span>,
      node: (
        <Input
          key="label"
          aria-label="Label"
          placeholder="Label"
          className="h-8 w-32"
          value={values.connectorLabel}
          onChange={(event) => apply.connectorLabel(event.target.value)}
        />
      ),
    });
  }
  return sections;
}
