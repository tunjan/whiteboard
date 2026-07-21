import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Shape } from '@whiteboard/shared';
import {
  Copy,
  CopyPlus,
  Crop,
  EyeOff,
  Group,
  ImageDown,
  Lock,
  LockOpen,
  MoreHorizontal,
  SendToBack,
  Trash2,
  Ungroup,
} from 'lucide-react';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import { alignShapes, distributeShapes } from './align';
import { copyShapes } from './clipboard';
import { duplicateShapes, groupShapes, ungroupShapes } from './commands';
import { exportSelectionToPng } from './export-png';
import { deleteTargetIds } from './hierarchy';
import { getSelectionInfo } from './selection-geometry';

/** Stable empty array for the non-group selection path (see `hasGroup`). */
const NO_SHAPES: Shape[] = [];

import { editor, useDocumentStore } from './use-document-store';
import { useHiddenStore } from './use-hidden-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useSelectionStore } from './use-selection-store';
import { bringToFront, sendBackward, sendToBack, bringForward } from './z-order';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SelectionToolbarProps {
  camera: Camera;
}

/** Screen-px gap between the selection's edge and the floating bar. */
const GAP = 12;
/** Roughly the rendered bar width; only used to keep it on-screen. */
const APPROX_WIDTH = 232;

/**
 * Figma-style contextual bar that floats above the current selection, exposing
 * the most common edit actions. It reuses the same action functions as the
 * right-click menu (`canvas-context-menu.tsx`); it is purely additive.
 *
 * Rendered as an HTML overlay in screen space (sibling of `SelectionLayer`).
 * The `data-ui-layer` marker keeps the canvas from treating clicks here as
 * surface/pointer gestures (see `isSurfaceEvent` in `Canvas.tsx`).
 */
export function SelectionToolbar({ camera }: SelectionToolbarProps) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const marquee = useSelectionStore((s) => s.marquee);
  // Only the selected shapes — the toolbar just needs to follow their bounds.
  // Subscribing to the whole `shapes` array re-rendered it (and re-ran the
  // full-document scan in `getSelectionInfo`) once per frame of every stroke.
  const shapesRecord = useDocumentStore(
    useShallow((s) => {
      const record = s.doc.pages[s.currentPageId]?.shapes;
      const out: Record<string, Shape> = {};
      if (!record) return out;
      for (const id of selectedIds) {
        const shape = record[id];
        if (shape) out[id] = shape;
      }
      return out;
    }),
  );
  // A group's box comes from its descendants, so only then depend on the whole
  // document (see the same note in SelectionLayer).
  const selectionHasGroup = Object.values(shapesRecord).some(
    (s) => s.type === 'group',
  );
  const shapes = useDocumentStore((s) =>
    selectionHasGroup ? s.shapes : NO_SHAPES,
  );

  // Hide while a drag-select is in progress to avoid flicker.
  if (marquee) return null;

  const info = getSelectionInfo(
    shapes,
    selectedIds,
    camera.z,
    (id) => shapesRecord[id],
  );
  if (!info) return null;

  // Derived availability — mirrors canvas-context-menu.tsx.
  const allLocked = selectedIds.every((id) => editor.getShape(id)?.locked);
  const canAlign = selectedIds.length >= 2;
  const canDistribute = selectedIds.length >= 3;
  const canGroup = selectedIds.length >= 2;
  const hasGroup = selectedIds.some(
    (id) => editor.getShape(id)?.type === 'group',
  );
  const singleImageId =
    selectedIds.length === 1 && editor.getShape(selectedIds[0]!)?.type === 'image'
      ? selectedIds[0]!
      : null;

  // Position above the topmost (rotated) corner, centered on the bounds center.
  const corners = [
    info.corners.nw,
    info.corners.ne,
    info.corners.se,
    info.corners.sw,
  ].map((p) => worldToScreen(p, camera));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));
  const centerX = worldToScreen(info.center, camera).x;

  // Flip below the selection when there isn't room above.
  const below = minY - GAP < 44;
  const top = below ? maxY + GAP : minY - GAP;
  const left = Math.min(
    Math.max(centerX, APPROX_WIDTH / 2 + 8),
    window.innerWidth - APPROX_WIDTH / 2 - 8,
  );

  const setLocked = (locked: boolean) => {
    for (const id of selectedIds) editor.updateShape(id, { locked });
  };

  const setSelection = useSelectionStore.getState().setSelection;
  const align = (edge: Parameters<typeof alignShapes>[2]) =>
    alignShapes(editor, selectedIds, edge);

  return (
    <TooltipProvider delay={300}>
      <div
        data-ui-layer
        className="pointer-events-auto absolute z-20"
        style={{
          left,
          top,
          // Keep both axes in one transform. Tailwind's translate utility uses
          // the individual `translate` property and would shift X a second time.
          transform: `translate(-50%, ${below ? '0' : '-100%'})`,
        }}
      >
        <Surface
          role="toolbar"
          aria-label="Selection actions"
          className={cn(
            'touch-targets flex h-11 items-center gap-1.5 p-1.5 shadow-hover',
            'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200 motion-safe:ease-[var(--ease-out-expo)]',
            below
              ? 'origin-top motion-safe:slide-in-from-top-1'
              : 'origin-bottom motion-safe:slide-in-from-bottom-1',
          )}
        >
          <div className="flex items-center gap-0.5">
            <IconButton
              label="Duplicate"
              onClick={() => setSelection(duplicateShapes(editor, selectedIds))}
            >
              <CopyPlus />
            </IconButton>
          </div>

          <div className="flex items-center gap-0.5">
            <IconButton
              label="Bring to front"
              onClick={() => bringToFront(editor, selectedIds)}
            >
              <SendToBack className="rotate-180" />
            </IconButton>
            <IconButton
              label="Send to back"
              onClick={() => sendToBack(editor, selectedIds)}
            >
              <SendToBack />
            </IconButton>
          </div>

          <div className="flex items-center gap-0.5">
            <IconButton
              label={allLocked ? 'Unlock' : 'Lock'}
              active={allLocked}
              onClick={() => setLocked(!allLocked)}
            >
              {allLocked ? <Lock /> : <LockOpen />}
            </IconButton>
            <IconButton
              label="Delete"
              destructive
              disabled={allLocked}
              onClick={() => {
                const unlocked = selectedIds.filter(
                  (id) => !editor.getShape(id)?.locked,
                );
                editor.deleteShapes(
                  deleteTargetIds(editor.getShapes(), unlocked),
                );
                useSelectionStore.getState().clear();
              }}
            >
              <Trash2 />
            </IconButton>

            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      aria-label="More actions"
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                      )}
                    />
                  }
                >
                  <MoreHorizontal />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span>More actions</span>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={8}
                className="w-52"
              >
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => copyShapes(editor, selectedIds)}
                  >
                    <Copy />
                    Copy
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => bringForward(editor, selectedIds)}
                  >
                    Bring forward
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => sendBackward(editor, selectedIds)}
                  >
                    Send backward
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={!canAlign}>
                      Align
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-52">
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => align('left')}>
                          Align left
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => align('centerX')}>
                          Align center
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => align('right')}>
                          Align right
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={() => align('top')}>
                          Align top
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => align('centerY')}>
                          Align middle
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => align('bottom')}>
                          Align bottom
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          disabled={!canDistribute}
                          onClick={() =>
                            distributeShapes(
                              editor,
                              selectedIds,
                              'horizontal',
                            )
                          }
                        >
                          Distribute horizontally
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!canDistribute}
                          onClick={() =>
                            distributeShapes(editor, selectedIds, 'vertical')
                          }
                        >
                          Distribute vertically
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuItem
                    disabled={!canGroup}
                    onClick={() => {
                      const gid = groupShapes(editor, selectedIds);
                      if (gid) setSelection([gid]);
                    }}
                  >
                    <Group />
                    Group
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!hasGroup}
                    onClick={() => {
                      const freed = ungroupShapes(editor, selectedIds);
                      if (freed.length) setSelection(freed);
                    }}
                  >
                    <Ungroup />
                    Ungroup
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() =>
                      void exportSelectionToPng(selectedIds, 'selection')
                    }
                  >
                    <ImageDown />
                    Export PNG
                  </DropdownMenuItem>
                  {singleImageId && (
                    <DropdownMenuItem
                      onClick={() =>
                        useImageCroppingStore.getState().start(singleImageId)
                      }
                    >
                      <Crop />
                      Crop
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      useHiddenStore
                        .getState()
                        .hide(deleteTargetIds(editor.getShapes(), selectedIds));
                      useSelectionStore.getState().clear();
                    }}
                  >
                    <EyeOff />
                    Hide
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Surface>
      </div>
    </TooltipProvider>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  destructive,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active || undefined}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
          'disabled:border-transparent disabled:bg-transparent disabled:text-content-muted',
          active &&
            'bg-bg-muted text-content-emphasis hover:bg-bg-muted hover:text-content-emphasis',
          destructive &&
            'hover:bg-bg-error hover:text-content-error',
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">
        <span>{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}
