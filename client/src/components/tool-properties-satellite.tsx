import { useRef, type ReactNode } from 'react';
import { useStyleControls } from '@/canvas/use-style-controls';
import { SIZE_OPTIONS } from '@/canvas/use-style-store';
import { ToolbarSurface } from '@/components/toolbar/toolbar-primitives';
import { ToolLockButton } from '@/components/toolbar/toolbar-lock-button';
import { StickerStrip } from '@/components/toolbar/toolbar-sticker-strip';
import {
  INKING_TOOLS,
  SHAPE_MENU_TOOLS,
} from '@/components/toolbar/toolbar-constants';
import { ColorRamp } from '@/components/toolbar/toolbar-color-ramp';
import { InkTray } from '@/components/toolbar/toolbar-ink-tray';
import { ShapeTray } from '@/components/toolbar/toolbar-shape-tray';
import {
  EraserMode,
  styleSections,
  WEIGHT_STROKES,
  WeightRow,
  type Section,
} from '@/components/toolbar/toolbar-style-sections';
import { TrayMenu } from '@/components/toolbar/toolbar-tray-controls';
import { cn, swatchBorder } from '@/lib/utils';

/**
 * The active tool's properties, on a plate above the toolbar.
 *
 * Three zones, each a different kind of control, so each reads as what it is
 * without a label: a ramp of colour dots, a segmented row of stroke weights,
 * and one key that opens everything else. The two things reached for on every
 * stroke are one click away; the rest is one click further.
 *
 * Two marks, and they never swap: a *value* in a row is a neutral pill that
 * slides to it, and the chosen colour wears a ring. Blue is the toolbar's —
 * it marks the tool, not its settings.
 */

/** Tools whose tray leads with their defining choice, drawn in the open. */
const OPEN_TRAY_TOOLS = new Set(['arrow']);

/** Tools that stay on after use, so tool lock has nothing to keep. */
const NEVER_COMPLETE = new Set([
  'select',
  'hand',
  'laser',
  'draw',
  'highlighter',
  'eraser',
  'straightedge',
  'compass',
  'measure',
]);

export function ToolPropertiesSatellite({
  activeToolId,
  placement = 'bottom',
  fullPalette = false,
  fewColours = false,
  barHidden = false,
}: {
  activeToolId: string;
  /** Which bar it serves: centred above a bottom bar, or beside a left rail. */
  placement?: 'bottom' | 'left';
  /** Every colour on the ramp, not eight and a key for the rest. */
  fullPalette?: boolean;
  /** Two colours rather than four under the narrow bar: a phone's width. */
  fewColours?: boolean;
  /** The bar has been put away, so its tray goes with it. */
  barHidden?: boolean;
}) {
  const { visible: applies, show, values, apply } = useStyleControls(activeToolId);
  const visible = applies && !barHidden;

  // Keep the last tool's controls while the bar animates out.
  const shown = useRef(show);
  const shownTool = useRef(activeToolId);
  if (visible) {
    shown.current = show;
    shownTool.current = activeToolId;
  }
  const on = shown.current;
  const tool = shownTool.current;
  // Under a bottom bar every tray is one row of one height, so changing tool
  // changes what is in the tray and never where the board's edge is.
  const bottom = placement === 'bottom';
  // A shape tool gets the shape tray: the shapes themselves, then each
  // setting as its value behind a chevron.
  const shapeTray = bottom && SHAPE_MENU_TOOLS.includes(tool);
  // The arrow gets the same tray: what kind of arrow it lays down out in the
  // open, the rest behind chevrons.
  const drawnTray = shapeTray || (bottom && OPEN_TRAY_TOOLS.has(tool));
  const inking = (INKING_TOOLS as readonly string[]).includes(tool);
  // Anything else leads with its colours, then a menu per setting.
  const oneRow = bottom && !drawnTray;

  // The second row: what the shape is first, then how it is painted, then
  // how solid it is. In the tray each is a menu of its own, shown by its value.
  const sections = styleSections(on, { values, apply }, bottom);
  const open = sections.filter((section) => section.open);

  const zones: ReactNode[] = [];
  if (inking) {
    zones.push(<InkTray key="ink" activeToolId={tool} />);
  }
  if (on.eraserMode) zones.push(<EraserMode key="eraser" />);
  if (on.color) {
    // Where something else shares the row, the eight that keys 1–8 reach: the
    // strong hues, with the light ones behind the colour key. Four under the
    // narrow bar, two on a phone.
    const crowded = inking || open.length > 0;
    const trayCount = fullPalette ? (crowded ? 8 : undefined) : fewColours ? 2 : 4;
    zones.push(
      <ColorRamp
        key="color"
        color={values.color}
        onSelect={apply.color}
        barVisible={visible}
        count={oneRow ? trayCount : fullPalette ? undefined : 8}
      />,
    );
  }
  const sizeControl = (
    <WeightRow
      key="size"
      value={values.size}
      onSelect={apply.size}
      inTray={bottom}
    />
  );
  if (on.size && !bottom) zones.push(sizeControl);
  if (on.sticker) zones.push(<StickerStrip key="sticker" />);
  // Placing a shape hands back to Select unless the tool is locked; the key
  // sits with the tools that do that, so the choice is where it applies.
  const lock = !NEVER_COMPLETE.has(tool) ? <ToolLockButton key="lock" /> : null;
  if (lock && !bottom) zones.push(lock);

  const sizeIndex = SIZE_OPTIONS.findIndex((option) => option.value === values.size);

  // The tray's menus: the stroke and its weight together, then the rest in row
  // order. Under the narrow bar the rest share the weight's menu.
  const menuOf = (section: Section) => (
    <TrayMenu
      key={section.key}
      label={section.label}
      barVisible={visible}
      value={section.value}
    >
      {section.node}
    </TrayMenu>
  );
  const stroke = sections.find((section) => section.key === 'stroke');
  const rest = sections.filter(
    (section) => section !== stroke && !section.open,
  );
  const folded = !fullPalette && on.size;
  // Each drawn group folds behind one key under the narrow bar, as the shapes do.
  const openGroups = open.map((section) =>
    fullPalette ? section.node : menuOf(section),
  );
  // What the row ends on stays at the tray's end, so the settings have one
  // place to be found whatever the tool. A sticker strip reaches that end by
  // itself.
  const spacer = on.sticker ? null : <span aria-hidden="true" className="tray-spacer" />;
  const trayMenus = [
    stroke && menuOf(stroke),
    on.size && (
      <TrayMenu
        key="size"
        label="Stroke weight"
        barVisible={visible}
        value={
          sizeIndex < 0 ? (
            <span className="tray-value">Custom</span>
          ) : (
            <span
              aria-hidden="true"
              className="tbar-weight"
              style={{ height: WEIGHT_STROKES[sizeIndex] }}
            />
          )
        }
      >
        {folded && rest.map((section) => section.node)}
        {sizeControl}
      </TrayMenu>
    ),
    ...(folded ? [] : rest.map(menuOf)),
  ];

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      data-visible={visible}
      data-placement={placement}
      className={cn(
        // The wrapper is scaled by `--drawer-scale`, so the limit is too.
        'absolute w-max max-w-[calc((100vw-1rem)/var(--drawer-scale))]',
        // Over a bottom bar it is the drawer's tray: as wide as the bar at
        // least, and tucked behind its top edge. The shape tray is exactly as
        // wide; its shapes give way rather than overhang.
        placement === 'left'
          ? 'top-1/2 left-full ml-2 -translate-y-1/2'
          : cn(
              'bottom-[calc(100%-var(--drawer-tuck))] left-1/2 -translate-x-1/2',
              drawnTray || on.sticker ? 'w-full' : 'min-w-full',
            ),
        'style-bar-motion',
      )}
    >
      <ToolbarSurface
        role="group"
        aria-label="Style controls"
        className="tbar tbar-style"
        data-one-row={bottom || undefined}
        data-shape-tray={drawnTray || undefined}
      >
        {bottom ? (
          // Keyed by kind of tray, so a change of tool settles in rather than
          // cutting; pen to highlighter is the same tray and does not.
          <div
            key={inking ? 'ink' : shapeTray ? 'shape' : tool}
            className="tbar-style-row tray-swap"
          >
            {drawnTray ? (
              <>
                {shapeTray && (
                  <ShapeTray
                    activeToolId={tool}
                    barVisible={visible}
                    compact={!fullPalette}
                  />
                )}
                {openGroups}
                {spacer}
                <TrayMenu
                  label="Color"
                  barVisible={visible}
                  value={
                    <span
                      aria-hidden="true"
                      className="tray-dot"
                      style={{
                        backgroundColor: values.color,
                        borderColor: swatchBorder(values.color),
                      }}
                    />
                  }
                >
                  <ColorRamp
                    color={values.color}
                    onSelect={apply.color}
                    barVisible={visible}
                  />
                </TrayMenu>
              </>
            ) : (
              <>
                {zones}
                {openGroups}
                {spacer}
              </>
            )}
            {trayMenus}
            {lock ?? (fullPalette && <span aria-hidden="true" className="tray-lock-slot" />)}
          </div>
        ) : (
          <>
            {sections.length > 0 && (
              <div className="tbar-style-row">
                {sections.map((section) => section.node)}
              </div>
            )}
            <div className="tbar-style-row">{zones}</div>
          </>
        )}
      </ToolbarSurface>
    </div>
  );
}
