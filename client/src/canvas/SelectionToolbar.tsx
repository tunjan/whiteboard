import type { ReactNode } from 'react';
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
import { editor, useDocumentStore } from './use-document-store';
import { useHiddenStore } from './use-hidden-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useSelectionStore } from './use-selection-store';
import { bringToFront, sendBackward, sendToBack, bringForward } from './z-order';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
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
const APPROX_WIDTH = 320;

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
  const lasso = useSelectionStore((s) => s.lasso);
  const shapes = useDocumentStore((s) => s.shapes);

  // Hide while a drag-select is in progress to avoid flicker.
  if (marquee || lasso) return null;

  const info = getSelectionInfo(shapes, selectedIds, camera.z);
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
        className="absolute z-20 -translate-x-1/2 pointer-events-auto"
        style={{
          left,
          top,
          transform: `translate(-50%, ${below ? '0' : '-100%'})`,
        }}
      >
        <Surface className="touch-targets flex items-center gap-1 p-2">
          <IconButton
            label="Duplicate"
            onClick={() => setSelection(duplicateShapes(editor, selectedIds))}
          >
            <CopyPlus className="size-4" />
          </IconButton>
          <IconButton label="Copy" onClick={() => copyShapes(editor, selectedIds)}>
            <Copy className="size-4" />
          </IconButton>
          <IconButton
            label="Delete"
            destructive
            disabled={allLocked}
            onClick={() => {
              const unlocked = selectedIds.filter(
                (id) => !editor.getShape(id)?.locked,
              );
              editor.deleteShapes(deleteTargetIds(editor.getShapes(), unlocked));
              useSelectionStore.getState().clear();
            }}
          >
            <Trash2 className="size-4" />
          </IconButton>

          <div className="mx-1 h-5 w-px bg-border-subtle" />

          <IconButton
            label="Bring to front"
            onClick={() => bringToFront(editor, selectedIds)}
          >
            <SendToBack className="size-4 rotate-180" />
          </IconButton>
          <IconButton
            label="Send to back"
            onClick={() => sendToBack(editor, selectedIds)}
          >
            <SendToBack className="size-4" />
          </IconButton>
          <IconButton
            label={allLocked ? 'Unlock' : 'Lock'}
            onClick={() => setLocked(!allLocked)}
          >
            {allLocked ? (
              <Lock className="size-4" />
            ) : (
              <LockOpen className="size-4" />
            )}
          </IconButton>

          <div className="mx-1 h-5 w-px bg-border-subtle" />

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    aria-label="More actions"
                    className={cn(
                      buttonVariants({ variant: 'ghost', size: 'icon' }),
                    )}
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="top">
                <span>More</span>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="top" align="end" className="w-48">
              <DropdownMenuItem onClick={() => bringForward(editor, selectedIds)}>
                Bring forward
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sendBackward(editor, selectedIds)}>
                Send backward
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={!canAlign}>
                  Align
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  <DropdownMenuItem onClick={() => align('left')}>
                    Align left
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => align('centerX')}>
                    Align center
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => align('right')}>
                    Align right
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => align('top')}>
                    Align top
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => align('centerY')}>
                    Align middle
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => align('bottom')}>
                    Align bottom
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!canDistribute}
                    onClick={() =>
                      distributeShapes(editor, selectedIds, 'horizontal')
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
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuItem
                disabled={!canGroup}
                onClick={() => {
                  const gid = groupShapes(editor, selectedIds);
                  if (gid) setSelection([gid]);
                }}
              >
                <Group className="size-4" />
                Group
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!hasGroup}
                onClick={() => {
                  const freed = ungroupShapes(editor, selectedIds);
                  if (freed.length) setSelection(freed);
                }}
              >
                <Ungroup className="size-4" />
                Ungroup
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onClick={() =>
                  void exportSelectionToPng(selectedIds, 'selection')
                }
              >
                <ImageDown className="size-4" />
                Export as PNG
              </DropdownMenuItem>
              {singleImageId && (
                <DropdownMenuItem
                  onClick={() =>
                    useImageCroppingStore.getState().start(singleImageId)
                  }
                >
                  <Crop className="size-4" />
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
                <EyeOff className="size-4" />
                Hide
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          destructive &&
            'text-content-error hover:bg-bg-error hover:text-content-error',
          disabled && 'pointer-events-none opacity-50',
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
