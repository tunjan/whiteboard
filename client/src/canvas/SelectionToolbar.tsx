import { useEffect, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Tooltip } from '@base-ui/react/tooltip';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Blend,
  BringToFront,
  ClipboardCopy,
  Copy,
  CopyPlus,
  Crop,
  EyeOff,
  Group,
  ImageDown,
  Loader2,
  Lock,
  MoreHorizontal,
  SendToBack,
  Sigma,
  Trash2,
  Ungroup,
  Unlock,
} from 'lucide-react';
import { aiLatexEnabled } from '@/board/latex-ai';
import { type Point, worldToScreen } from './camera';
import { alignShapes, distributeShapes } from './align';
import { copyShapes } from './clipboard';
import {
  deleteShapesWithCleanup,
  duplicateShapes,
  groupShapes,
  ungroupShapes,
} from './commands';
import {
  copySelectionToPngClipboard,
  exportSelectionToPng,
} from './export-png';
import { deleteTargetIds } from './hierarchy';
import {
  convertSelectionToEquation,
  convertibleShapeIds,
} from './ink-to-latex';
import { convertSelectionToGraph } from './ink-to-graph';
import { GraphGlyph } from '@/components/ui/glyphs';
import { isCoarsePointer, isDarwin } from './platform';
import { getSelectionInfo } from './selection-geometry';


import { useCameraPlacement } from './use-camera-interaction';
import { useGroupSubtree } from './use-group-subtree';
import { useCameraStore } from './use-camera-store';
import { editor } from './use-document-store';
import { useShapesById } from './use-shapes';
import { useHiddenStore } from './use-hidden-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useSelectionStore } from './use-selection-store';
import {
  bringToFront,
  sendBackward,
  sendToBack,
  bringForward,
} from './z-order';
import { OpacitySlider } from '@/components/opacity-slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/toast';
import { useStyleControls } from './use-style-controls';
import { ColorEditor } from '@/components/color-editor';
import { swatchBorder } from '@/lib/utils';

/** Screen-px gap between the selection's edge and the floating bar. */
const GAP = 12;
/**
 * Roughly the rendered bar width — seven 32px keys, two hairline runs and the
 * plate's own padding. Only used to keep the bar on-screen, so it does not
 * have to track the conditional equation key exactly.
 */
const APPROX_WIDTH = 256;

/**
 * The shortcut as the platform writes it. Firefox names the accelerator in
 * every menu row and in every tooltip, and writes it the way the OS does:
 * glyphs on macOS, spelled-out modifiers everywhere else.
 */
const MAC = isDarwin();
const sc = (key: string, shift = false) =>
  MAC ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
const DELETE_KEY = MAC ? '⌫' : 'Del';
const LOCK_KEY = MAC ? '⇧L' : 'Shift+L';

/**
 * The contextual popup over the current selection: the same plate as the main
 * toolbar (hairline edge, one soft drop), a packed row of 32px keys grouped by
 * air, plus the overflow menu the trailing key opens. The look lives in
 * section 10 of `index.css`.
 *
 * It reuses the same action functions as the right-click menu
 * (`canvas-context-menu.tsx`); it is purely additive.
 *
 * Rendered as an HTML overlay in screen space (sibling of `SelectionLayer`).
 * The `data-ui-layer` marker keeps the canvas from treating clicks here as
 * surface/pointer gestures (see `isSurfaceEvent` in `Canvas.tsx`).
 */
export function SelectionToolbar() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  // Handle sizes, and so the selection's box, depend on the zoom; only that
  // re-renders the bar, and only while there is a selection.
  const zoom = useCameraStore((s) =>
    selectedIds.length > 0 ? s.camera.z : 1,
  );
  // The bar clamps and flips against the window, so it cannot ride a camera
  // follower: it is placed against the live camera directly, from the geometry
  // this render leaves in `anchor`, and a pan moves it without a re-render.
  let anchor: { corners: Point[]; center: Point } | null = null;
  // Which side the bar sits on also picks the overflow panel's side, so it is
  // state — but it changes only when the bar flips, not on every pan frame.
  const [below, setBelow] = useState(false);
  const placeBar = useCameraPlacement<HTMLDivElement>((element, camera) => {
    if (!anchor) return;
    // Above the topmost (rotated) corner, centered on the bounds center.
    const corners = anchor.corners.map((p) => worldToScreen(p, camera));
    const minY = Math.min(...corners.map((p) => p.y));
    const maxY = Math.max(...corners.map((p) => p.y));
    const centerX = worldToScreen(anchor.center, camera).x;
    // Flip below the selection when there isn't room above.
    const below = minY - GAP < 44;
    const top = below ? maxY + GAP : minY - GAP;
    const left = Math.min(
      Math.max(centerX, APPROX_WIDTH / 2 + 8),
      window.innerWidth - APPROX_WIDTH / 2 - 8,
    );
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    // Keep both axes in one transform. Tailwind's translate utility uses the
    // individual `translate` property and would shift X a second time.
    element.style.transform = `translate(-50%, ${below ? '0' : '-100%'})`;
    setBelow(below);
  });
  const marquee = useSelectionStore((s) => s.marquee);
  // Only the selected shapes — the toolbar just needs to follow their bounds.
  // Subscribing to the whole `shapes` array re-rendered it (and re-ran the
  // full-document scan in `getSelectionInfo`) once per frame of every stroke.
  const shapesRecord = useShapesById(selectedIds);
  // A group's box comes from its descendants (see the same note in
  // SelectionLayer).
  const shapes = useGroupSubtree(selectedIds);

  // Whether the server has an AI key configured, so the equation button only
  // appears where clicking it could work.
  const [aiEnabled, setAiEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    aiLatexEnabled().then((enabled) => {
      if (!cancelled) setAiEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [converting, setConverting] = useState(false);
  const [graphing, setGraphing] = useState(false);

  // Hide while a drag-select is in progress to avoid flicker.
  if (marquee) return null;

  const info = getSelectionInfo(
    shapes,
    selectedIds,
    zoom,
    (id) => shapesRecord[id],
    // Must match `SelectionLayer`, or the knob measured here is not the one
    // drawn: touch moves it to the lane this bar sits in.
    isCoarsePointer(),
  );
  if (!info) return null;
  // The rotate knob counts as part of the selection's extent: touch puts it in
  // the lane above the box, and a bar anchored to the box alone sat on it.
  const knob = info.rotateHandle;
  anchor = {
    corners: [
      info.corners.nw,
      info.corners.ne,
      info.corners.se,
      info.corners.sw,
      ...(knob
        ? [
            { x: knob.point.x, y: knob.point.y - knob.radius },
            { x: knob.point.x, y: knob.point.y + knob.radius },
          ]
        : []),
    ],
    center: info.center,
  };

  // Derived availability — mirrors canvas-context-menu.tsx.
  const allLocked = selectedIds.every((id) => editor.getShape(id)?.locked);
  const canAlign = selectedIds.length >= 2;
  const canDistribute = selectedIds.length >= 3;
  const canGroup = selectedIds.length >= 2;
  const hasGroup = selectedIds.some(
    (id) => editor.getShape(id)?.type === 'group',
  );
  const singleImageId =
    selectedIds.length === 1 &&
    editor.getShape(selectedIds[0]!)?.type === 'image'
      ? selectedIds[0]!
      : null;
  const convertibleIds = convertibleShapeIds(selectedIds);
  const canConvertToEquation =
    aiEnabled &&
    convertibleIds !== null &&
    !selectedIds.some((id) => editor.getShape(id)?.locked);

  const setLocked = (locked: boolean) => {
    for (const id of selectedIds) editor.updateShape(id, { locked });
  };

  const setSelection = useSelectionStore.getState().setSelection;

  const convertToEquation = async () => {
    if (!convertibleIds || converting) return;
    setConverting(true);
    try {
      await convertSelectionToEquation(convertibleIds);
    } catch (err) {
      toast.add({
        title: err instanceof Error ? err.message : 'Conversion failed',
        type: 'error',
      });
    } finally {
      setConverting(false);
    }
  };

  const convertToGraph = async () => {
    if (!convertibleIds || graphing) return;
    setGraphing(true);
    try {
      await convertSelectionToGraph(convertibleIds);
    } catch (err) {
      toast.add({
        title: err instanceof Error ? err.message : 'Conversion failed',
        type: 'error',
      });
    } finally {
      setGraphing(false);
    }
  };

  return (
    <Tooltip.Provider delay={500} closeDelay={0}>
      <div
        ref={placeBar}
        data-ui-layer
        className="pointer-events-auto absolute z-[var(--z-canvas-front)]"
      >
        <div
          role="toolbar"
          aria-label="Selection actions"
          data-open
          data-below={below || undefined}
          className="fxp-panel fxp-bar"
        >
          {canConvertToEquation && (
            <Key
              label="Convert to equation"
              disabled={converting}
              onClick={convertToEquation}
            >
              {converting ? <Loader2 className="animate-spin" /> : <Sigma />}
            </Key>
          )}
          {canConvertToEquation && (
            <Key
              label="Graph function"
              disabled={graphing}
              onClick={convertToGraph}
            >
              {graphing ? <Loader2 className="animate-spin" /> : <GraphGlyph />}
            </Key>
          )}

          <Key
            label="Duplicate"
            shortcut={sc('D')}
            onClick={() => setSelection(duplicateShapes(editor, selectedIds))}
          >
            <CopyPlus />
          </Key>

          <ColorKey below={below} />
          <OpacityKey below={below} />

          <span className="fxp-bar-sep" role="separator" />

          <Key
            label="Bring to front"
            shortcut={sc(']', true)}
            onClick={() => bringToFront(editor, selectedIds)}
          >
            <BringToFront />
          </Key>
          <Key
            label="Send to back"
            shortcut={sc('[', true)}
            onClick={() => sendToBack(editor, selectedIds)}
          >
            <SendToBack />
          </Key>

          <span className="fxp-bar-sep" role="separator" />

          <Key
            label={allLocked ? 'Unlock' : 'Lock'}
            shortcut={LOCK_KEY}
            pressed={allLocked}
            onClick={() => setLocked(!allLocked)}
          >
            {allLocked ? <Lock /> : <Unlock />}
          </Key>
          <Key
            label="Delete"
            shortcut={DELETE_KEY}
            danger
            disabled={allLocked}
            onClick={() => {
              const unlocked = selectedIds.filter(
                (id) => !editor.getShape(id)?.locked,
              );
              deleteShapesWithCleanup(
                editor,
                deleteTargetIds(editor.getShapes(), unlocked),
              );
              useSelectionStore.getState().clear();
            }}
          >
            <Trash2 />
          </Key>

          <OverflowPanel
            below={below}
            selectedIds={selectedIds}
            canAlign={canAlign}
            canDistribute={canDistribute}
            canGroup={canGroup}
            hasGroup={hasGroup}
            singleImageId={singleImageId}
          />
        </div>
      </div>
    </Tooltip.Provider>
  );
}

/**
 * A key on the bar. Its whole state model is fill and glyph opacity — Firefox
 * toolbar buttons never move, grow or lift — and the tooltip carries the name
 * plus the accelerator, which is the only place either appears.
 */
function Key({
  label,
  shortcut,
  onClick,
  disabled,
  danger,
  pressed,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        className={`fxp-key${danger ? ' fxp-key--danger' : ''}`}
      >
        {children}
      </Tooltip.Trigger>
      <Tip label={label} shortcut={shortcut} />
    </Tooltip.Root>
  );
}

/**
 * The selection's colour, on the bar over the object so recolouring it does
 * not mean a trip to the style bar at the foot of the screen. Hidden for
 * shapes that carry fixed artwork (images, stickers, video).
 */
function ColorKey({ below }: { below: boolean }) {
  const { show, values, apply } = useStyleControls('select');
  const [open, setOpen] = useState(false);
  if (!show.color) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={<PopoverTrigger aria-label="Color" className="fxp-key" />}
        >
          <span
            aria-hidden="true"
            className="tbar-swatch"
            style={{
              backgroundColor: values.color,
              borderColor: swatchBorder(values.color),
            }}
          />
        </Tooltip.Trigger>
        <Tip label="Color" />
      </Tooltip.Root>
      <PopoverContent
        side={below ? 'bottom' : 'top'}
        sideOffset={6}
        className="fxp-panel w-auto p-1 [--tb-item:32px]"
      >
        <ColorEditor
          color={values.color}
          onSelect={apply.color}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * How solid the selection is. It sits on the bar over the object rather than
 * in the style bar at the foot of the screen, so the fader and what it fades
 * are in the same place.
 */
function OpacityKey({ below }: { below: boolean }) {
  const { values, apply } = useStyleControls('select');
  return (
    <Popover>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={<PopoverTrigger aria-label="Opacity" className="fxp-key" />}
        >
          <Blend />
        </Tooltip.Trigger>
        <Tip label="Opacity" />
      </Tooltip.Root>
      <PopoverContent
        side={below ? 'bottom' : 'top'}
        sideOffset={6}
        className="fxp-panel fxp-opacity"
      >
        <div className="tbar-section">
          <div className="tbar-section-head">
            <span>Opacity</span>
            <span className="tabular-nums">
              {Math.round(values.opacity * 100)}%
            </span>
          </div>
          <div className="px-1 py-1.5">
            <OpacitySlider
              aria-label="Opacity"
              value={values.opacity}
              onValueChange={apply.opacity}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A small plate of the panel's own material: the name, then the shortcut. */
function Tip({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <Tooltip.Portal>
      <Tooltip.Positioner side="top" sideOffset={6} className="isolate z-50">
        <Tooltip.Popup className="fxp-tip">
          {label}
          {shortcut && <kbd className="fxp-tip-key">{shortcut}</kbd>}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  );
}

/**
 * The overflow panel: everything that does not earn a key on the bar, in three
 * runs — take it elsewhere, arrange it, organise it. Rows that cannot apply to
 * this selection are left out rather than greyed, and alignment is a strip of
 * keys you can press several times without the menu closing.
 */
export function OverflowPanel({
  below,
  selectedIds,
  canAlign,
  canDistribute,
  canGroup,
  hasGroup,
  singleImageId,
}: {
  below: boolean;
  selectedIds: string[];
  canAlign: boolean;
  canDistribute: boolean;
  canGroup: boolean;
  hasGroup: boolean;
  singleImageId: string | null;
}) {
  const setSelection = useSelectionStore.getState().setSelection;
  const align = (edge: Parameters<typeof alignShapes>[2]) =>
    alignShapes(editor, selectedIds, edge);

  return (
    <Menu.Root>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Menu.Trigger aria-label="More actions" className="fxp-key" />
          }
        >
          <MoreHorizontal />
        </Tooltip.Trigger>
        <Tip label="More actions" />
      </Tooltip.Root>

      <Menu.Portal>
        <Menu.Positioner
          side={below ? 'bottom' : 'top'}
          align="end"
          sideOffset={6}
          className="isolate z-50 outline-none"
        >
          <Menu.Popup className="fxp-panel fxp-menu">
            <Row
              icon={<Copy />}
              label="Copy"
              shortcut={sc('C')}
              onClick={() => copyShapes(editor, selectedIds)}
            />
            <Row
              icon={<ClipboardCopy />}
              label="Copy as PNG"
              shortcut={sc('C', true)}
              // Not awaited: the clipboard write has to be issued while this
              // click is still the current task (see `writePngToClipboard`).
              onClick={() => {
                copySelectionToPngClipboard(selectedIds).catch((err: unknown) =>
                  console.error('[clipboard] copy as PNG failed', err),
                );
              }}
            />
            <Row
              icon={<ImageDown />}
              label="Export PNG…"
              onClick={() =>
                void exportSelectionToPng(selectedIds, 'selection')
              }
            />

            <div className="fxp-rule" role="separator" />

            <Row
              icon={<BringToFront />}
              label="Bring forward"
              shortcut={sc(']')}
              onClick={() => bringForward(editor, selectedIds)}
            />
            <Row
              icon={<SendToBack />}
              label="Send backward"
              shortcut={sc('[')}
              onClick={() => sendBackward(editor, selectedIds)}
            />

            {canAlign && (
              <Menu.Group aria-label="Align" className="fxp-strip">
                <StripKey label="Align left" onClick={() => align('left')}>
                  <AlignStartVertical />
                </StripKey>
                <StripKey label="Align center" onClick={() => align('centerX')}>
                  <AlignCenterVertical />
                </StripKey>
                <StripKey label="Align right" onClick={() => align('right')}>
                  <AlignEndVertical />
                </StripKey>
                <span className="fxp-strip-gap" aria-hidden="true" />
                <StripKey label="Align top" onClick={() => align('top')}>
                  <AlignStartHorizontal />
                </StripKey>
                <StripKey label="Align middle" onClick={() => align('centerY')}>
                  <AlignCenterHorizontal />
                </StripKey>
                <StripKey label="Align bottom" onClick={() => align('bottom')}>
                  <AlignEndHorizontal />
                </StripKey>
                {canDistribute && (
                  <>
                    <span className="fxp-strip-gap" aria-hidden="true" />
                    <StripKey
                      label="Distribute horizontally"
                      onClick={() =>
                        distributeShapes(editor, selectedIds, 'horizontal')
                      }
                    >
                      <AlignHorizontalSpaceAround />
                    </StripKey>
                    <StripKey
                      label="Distribute vertically"
                      onClick={() =>
                        distributeShapes(editor, selectedIds, 'vertical')
                      }
                    >
                      <AlignVerticalSpaceAround />
                    </StripKey>
                  </>
                )}
              </Menu.Group>
            )}

            <div className="fxp-rule" role="separator" />

            {canGroup && (
              <Row
                icon={<Group />}
                label="Group"
                shortcut={sc('G')}
                onClick={() => {
                  const gid = groupShapes(editor, selectedIds);
                  if (gid) setSelection([gid]);
                }}
              />
            )}
            {hasGroup && (
              <Row
                icon={<Ungroup />}
                label="Ungroup"
                shortcut={sc('G', true)}
                onClick={() => {
                  const freed = ungroupShapes(editor, selectedIds);
                  if (freed.length) setSelection(freed);
                }}
              />
            )}
            {singleImageId && (
              <Row
                icon={<Crop />}
                label="Crop"
                onClick={() =>
                  useImageCroppingStore.getState().start(singleImageId)
                }
              />
            )}
            <Row
              icon={<EyeOff />}
              label="Hide"
              onClick={() => {
                useHiddenStore
                  .getState()
                  .hide(deleteTargetIds(editor.getShapes(), selectedIds));
                useSelectionStore.getState().clear();
              }}
            />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A row: icon, label, and the accelerator set against the trailing edge. */
function Row({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <Menu.Item className="fxp-row" onClick={onClick}>
      {icon}
      {label}
      {shortcut && <kbd className="fxp-row-aux">{shortcut}</kbd>}
    </Menu.Item>
  );
}

/** A key in the align strip. The menu stays open so edges can be tried in turn. */
function StripKey({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Menu.Item
            aria-label={label}
            closeOnClick={false}
            onClick={onClick}
            className="fxp-strip-key"
          />
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tip label={label} />
    </Tooltip.Root>
  );
}
