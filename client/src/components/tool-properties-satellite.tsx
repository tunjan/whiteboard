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
  WEIGHT_NAMES,
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
const OPEN_TRAY_TOOLS = new Set(['arrow', 'text']);

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
}: {
  activeToolId: string;
  /** Which bar it serves: centred above a bottom bar, or beside a left rail. */
  placement?: 'bottom' | 'left';
  /** Every colour on the ramp, not eight and a key for the rest. */
  fullPalette?: boolean;
}) {
  const { visible, show, values, apply } = useStyleControls(activeToolId);

  // Keep the last tool's controls while the bar animates out.
  const shown = useRef(show);
  const shownTool = useRef(activeToolId);
  if (visible) {
    shown.current = show;
    shownTool.current = activeToolId;
  }
  const on = shown.current;
  // A shape tool under a bottom bar gets the shape tray: one row, the shapes
  // themselves, then each setting as its value behind a chevron.
  const shapeTray =
    placement === 'bottom' && SHAPE_MENU_TOOLS.includes(shownTool.current);
  // Arrow and text get the same tray: what kind of arrow or type it lays down
  // out in the open, the rest behind chevrons.
  const drawnTray =
    shapeTray ||
    (placement === 'bottom' && OPEN_TRAY_TOOLS.has(shownTool.current));

  const inking = (INKING_TOOLS as readonly string[]).includes(activeToolId);
  // The ink tray is one row under a bottom bar: seven colours (four under
  // the narrow bar), then a menu per setting.
  const oneRow = inking && placement === 'bottom';
  // In the tray the settings sit behind a chevron, with room to name them.
  const inTray = oneRow || drawnTray;

  // The second row: what the shape is first, then how it is painted, then
  // how solid it is. In the tray each is a menu of its own, shown by its value.
  const sections = styleSections(on, { values, apply }, inTray);

  const zones: ReactNode[] = [];
  if (inking) {
    zones.push(<InkTray key="ink" activeToolId={activeToolId} />);
  }
  if (on.eraserMode) zones.push(<EraserMode key="eraser" />);
  if (on.color) {
    zones.push(
      <ColorRamp
        key="color"
        color={values.color}
        onSelect={apply.color}
        barVisible={visible}
        count={oneRow ? (fullPalette ? 7 : 4) : fullPalette ? undefined : 8}
      />,
    );
  }
  const sizeControl = (
    <WeightRow
      key="size"
      value={values.size}
      onSelect={apply.size}
      inTray={inTray}
    />
  );
  if (on.size && !oneRow) zones.push(sizeControl);
  if (on.sticker) zones.push(<StickerStrip key="sticker" />);
  // Placing a shape hands back to Select unless the tool is locked; the key
  // sits with the tools that do that, so the choice is where it applies.
  const lock =
    visible && !NEVER_COMPLETE.has(activeToolId) ? (
      <ToolLockButton key="lock" />
    ) : null;
  if (lock) zones.push(lock);

  const sizeName = SIZE_OPTIONS.find((option) => option.value === values.size)?.name;

  // The tray's menus: the stroke first, right after the colours, then the
  // rest in row order, then the weight. Under the narrow bar the rest share
  // the weight's menu.
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
  const open = sections.filter((section) => section.open);
  const stroke = sections.find((section) => section.key === 'stroke');
  const rest = sections.filter(
    (section) => section !== stroke && !section.open,
  );
  const folded = !fullPalette && on.size;
  const trayMenus = [
    stroke && menuOf(stroke),
    ...(folded ? [] : rest.map(menuOf)),
    on.size && (
      <TrayMenu
        key="size"
        label="Stroke weight"
        barVisible={visible}
        value={
          <span className="tray-value">
            {(sizeName && WEIGHT_NAMES[sizeName]) ?? sizeName}
          </span>
        }
      >
        {folded && rest.map((section) => section.node)}
        {sizeControl}
      </TrayMenu>
    ),
  ];

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      data-visible={visible}
      data-placement={placement}
      className={cn(
        'absolute w-max max-w-[calc(100vw-1rem)]',
        // Over a bottom bar it is the drawer's tray: as wide as the bar at
        // least, and tucked behind its top edge. The shape tray is exactly as
        // wide; its shapes give way rather than overhang.
        placement === 'left'
          ? 'top-1/2 left-full ml-2 -translate-y-1/2'
          : cn(
              'bottom-[calc(100%-var(--drawer-tuck))] left-1/2 -translate-x-1/2',
              drawnTray ? 'w-full' : 'min-w-full',
            ),
        'style-bar-motion',
      )}
    >
      <ToolbarSurface
        role="group"
        aria-label="Style controls"
        className="tbar tbar-style"
        data-one-row={oneRow || drawnTray || undefined}
        data-shape-tray={drawnTray || undefined}
      >
        {drawnTray ? (
          <div className="tbar-style-row">
            {shapeTray && (
              <ShapeTray
                activeToolId={shownTool.current}
                barVisible={visible}
                compact={!fullPalette}
              />
            )}
            {/* Under the narrow bar each drawn group folds behind one key
                showing its value, as the shapes do. */}
            {open.map((section) => (fullPalette ? section.node : menuOf(section)))}
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
            {trayMenus}
            {lock}
          </div>
        ) : oneRow ? (
          // Like the shape tray: the colours in the open, each other setting
          // behind a chevron of its own.
          <div className="tbar-style-row">
            {zones}
            {trayMenus}
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
