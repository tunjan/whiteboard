import type { ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { alignShapes, distributeShapes } from '@/canvas/align';
import { copyShapes, hasClipboard, pasteShapes } from '@/canvas/clipboard';
import {
  duplicateShapes,
  groupShapes,
  ungroupShapes,
} from '@/canvas/commands';
import {
  copySelectionToPngClipboard,
  exportSelectionToPng,
} from '@/canvas/export-png';
import { deleteTargetIds } from '@/canvas/hierarchy';
import { editor } from '@/canvas/use-document-store';
import { useHiddenStore } from '@/canvas/use-hidden-store';
import { useImageCroppingStore } from '@/canvas/use-image-cropping-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import {
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
} from '@/canvas/z-order';

/**
 * Right-click menu for the canvas. The Canvas selects the shape under the
 * cursor on contextmenu, so these act on the current selection.
 */
export function CanvasContextMenu({ children }: { children: ReactNode }) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const hidden = useHiddenStore((s) => s.hidden);
  const has = selectedIds.length > 0;
  const allLocked =
    has && selectedIds.every((id) => editor.getShape(id)?.locked);
  const hiddenCount = Object.keys(hidden).length;
  const canAlign = selectedIds.length >= 2;
  const canDistribute = selectedIds.length >= 3;
  const canGroup = selectedIds.length >= 2;
  const hasGroup = selectedIds.some((id) => editor.getShape(id)?.type === 'group');
  const singleImageId =
    selectedIds.length === 1 && editor.getShape(selectedIds[0]!)?.type === 'image'
      ? selectedIds[0]!
      : null;
  const align = (edge: Parameters<typeof alignShapes>[2]) =>
    alignShapes(editor, selectedIds, edge);

  const setLocked = (locked: boolean) => {
    for (const id of selectedIds) editor.updateShape(id, { locked });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="absolute inset-0">
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem
          disabled={!has}
          onClick={() => {
            const ids = duplicateShapes(editor, selectedIds);
            useSelectionStore.getState().setSelection(ids);
          }}
        >
          Duplicate
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!has || allLocked}
          variant="destructive"
          onClick={() => {
            const unlocked = selectedIds.filter(
              (id) => !editor.getShape(id)?.locked,
            );
            editor.deleteShapes(deleteTargetIds(editor.getShapes(), unlocked));
            useSelectionStore.getState().clear();
          }}
        >
          Delete
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={!has}
          onClick={() => copyShapes(editor, selectedIds)}
        >
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasClipboard()}
          onClick={() => {
            const ids = pasteShapes(editor);
            if (ids.length) useSelectionStore.getState().setSelection(ids);
          }}
        >
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!has}
          // Not awaited: the clipboard write has to be issued while this click
          // is still the current task (see `writePngToClipboard`).
          onClick={() => {
            copySelectionToPngClipboard(selectedIds).catch((err: unknown) =>
              console.error('[clipboard] copy as PNG failed', err),
            );
          }}
        >
          Copy as PNG
          <ContextMenuShortcut>⇧⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!has}
          onClick={() => void exportSelectionToPng(selectedIds, 'selection')}
        >
          Export as PNG
        </ContextMenuItem>
        {singleImageId && (
          <ContextMenuItem
            onClick={() => useImageCroppingStore.getState().start(singleImageId)}
          >
            Crop
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={!has}
          onClick={() => bringToFront(editor, selectedIds)}
        >
          Bring to front
          <ContextMenuShortcut>⌘⇧]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!has}
          onClick={() => bringForward(editor, selectedIds)}
        >
          Bring forward
          <ContextMenuShortcut>⌘]</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!has}
          onClick={() => sendBackward(editor, selectedIds)}
        >
          Send backward
          <ContextMenuShortcut>⌘[</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!has}
          onClick={() => sendToBack(editor, selectedIds)}
        >
          Send to back
          <ContextMenuShortcut>⌘⇧[</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!canAlign}>
            Align
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuItem onClick={() => align('left')}>
              Align left
            </ContextMenuItem>
            <ContextMenuItem onClick={() => align('centerX')}>
              Align center
            </ContextMenuItem>
            <ContextMenuItem onClick={() => align('right')}>
              Align right
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => align('top')}>
              Align top
            </ContextMenuItem>
            <ContextMenuItem onClick={() => align('centerY')}>
              Align middle
            </ContextMenuItem>
            <ContextMenuItem onClick={() => align('bottom')}>
              Align bottom
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              disabled={!canDistribute}
              onClick={() =>
                distributeShapes(editor, selectedIds, 'horizontal')
              }
            >
              Distribute horizontally
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!canDistribute}
              onClick={() => distributeShapes(editor, selectedIds, 'vertical')}
            >
              Distribute vertically
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem
          disabled={!canGroup}
          onClick={() => {
            const gid = groupShapes(editor, selectedIds);
            if (gid) useSelectionStore.getState().setSelection([gid]);
          }}
        >
          Group
          <ContextMenuShortcut>⌘G</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasGroup}
          onClick={() => {
            const freed = ungroupShapes(editor, selectedIds);
            if (freed.length) useSelectionStore.getState().setSelection(freed);
          }}
        >
          Ungroup
          <ContextMenuShortcut>⌘⇧G</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem disabled={!has} onClick={() => setLocked(!allLocked)}>
          {allLocked ? 'Unlock' : 'Lock'}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!has}
          onClick={() => {
            useHiddenStore
              .getState()
              .hide(deleteTargetIds(editor.getShapes(), selectedIds));
            useSelectionStore.getState().clear();
          }}
        >
          Hide
        </ContextMenuItem>
        {hiddenCount > 0 ? (
          <ContextMenuItem onClick={() => useHiddenStore.getState().showAll()}>
            Unhide all ({hiddenCount})
          </ContextMenuItem>
        ) : null}

        <ContextMenuSeparator />

        <ContextMenuItem
          onClick={() =>
            useSelectionStore
              .getState()
              .setSelection(editor.getShapes().map((s) => s.id))
          }
        >
          Select all
          <ContextMenuShortcut>⌘A</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
