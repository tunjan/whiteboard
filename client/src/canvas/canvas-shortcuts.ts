import { useEffect, type RefObject } from 'react';
import { noteActivity } from '@/collab/attention';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { writeShapesToOsClipboard } from '@/board/clipboard-os';
import { useThemeStore } from '@/use-theme-store';
import { nextDiscreteZoom } from './camera';
import { clipboardToken, copyShapes } from './clipboard';
import {
  deleteShapesWithCleanup,
  duplicateShapes,
  groupShapes,
  ungroupShapes,
} from './commands';
import { requestEquationFocus } from './equation-focus';
import { copySelectionToPngClipboard } from './export-png';
import { flipShapes } from './flip';
import type { GestureArbiter } from './gesture-arbiter';
import { deleteTargetIds, moveTargetIds } from './hierarchy';
import { isSelectable } from './selectable';
import { copyStyle, pasteStyle } from './style-clipboard';
import { toolRegistry } from './tools/tool-registry';
import type { ToolContext } from './tools/types';
import { useCameraStore } from './use-camera-store';
import { editor, redo, undo } from './use-document-store';
import { useEnteredGroupStore } from './use-entered-group-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { useSelectionStore } from './use-selection-store';
import { applyColor, stepSize } from './use-style-controls';
import { rampColors, useStyleStore } from './use-style-store';
import { useTextEditingStore } from './use-text-editing-store';
import { useToolLockStore } from './use-tool-lock-store';
import { useToolStore } from './use-tool-store';
import {
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
} from './z-order';

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      // The graph panel's MathLive field edits inside its shadow DOM, so events
      // retarget to the <math-field> host rather than a focusable input.
      !!el.closest?.('math-field') ||
      el.isContentEditable)
  );
}

export function useCanvasShortcuts({
  ctx,
  arbiter,
  centerRef,
  onZoomToFit,
  onZoomToSelection,
}: {
  ctx: ToolContext;
  arbiter: GestureArbiter;
  /** Live viewport center (screen px); zoom shortcuts anchor on it. */
  centerRef: RefObject<{ x: number; y: number }>;
  onZoomToFit: () => void;
  onZoomToSelection: () => void;
}): void {
  // Keyboard: selection ops, z-order, delete, escape, and tool hotkeys.
  // (Full configurable shortcut sweep is Phase 27.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      noteActivity();
      const mod = e.metaKey || e.ctrlKey;
      const ids = useSelectionStore.getState().selectedIds;
      const isModifierKey =
        e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta';

      // Active tools get the first chance at unmodified keys and live modifier
      // changes. The select tool re-tests an in-progress marquee when
      // Shift/Ctrl/Command changes without any pointer movement.
      if ((!mod && !e.altKey) || isModifierKey) {
        const handled = toolRegistry
          .get(useToolStore.getState().activeToolId)
          ?.onKeyDown?.(e, ctx);
        if (handled) return;
      }

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (ids.length) {
          useSelectionStore
            .getState()
            .setSelection(duplicateShapes(editor, ids));
        }
        return;
      }
      if (mod && e.key === 'a') {
        e.preventDefault();
        useSelectionStore.getState().setSelection(
          editor
            .getShapes()
            .filter(isSelectable)
            .map((s) => s.id),
        );
        return;
      }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          const freed = ungroupShapes(editor, ids);
          if (freed.length) useSelectionStore.getState().setSelection(freed);
        } else if (ids.length >= 2) {
          const gid = groupShapes(editor, ids);
          if (gid) useSelectionStore.getState().setSelection([gid]);
        }
        return;
      }
      if (mod && e.key === ']') {
        e.preventDefault();
        if (ids.length) (e.shiftKey ? bringToFront : bringForward)(editor, ids);
        return;
      }
      if (mod && e.key === '[') {
        e.preventDefault();
        if (ids.length) (e.shiftKey ? sendToBack : sendBackward)(editor, ids);
        return;
      }
      // Clipboard. Copy/cut also push to the OS clipboard; paste is handled by
      // the window 'paste' listener below so OS-image and in-app paths agree.
      //
      // Shift+Mod+C rasterizes the selection instead (`e.key` is uppercase
      // while shift is held, so this can't collide with the plain copy below).
      // Deliberately not awaited: the clipboard write must be issued while this
      // keydown is still the current task — see `writePngToClipboard`.
      if (mod && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        if (ids.length) {
          copySelectionToPngClipboard(ids).catch((err: unknown) =>
            console.error('[clipboard] copy as PNG failed', err),
          );
        }
        return;
      }
      // Style transfer, on the modifier pair Figma uses. Matched on `code`: on
      // macOS Option rewrites `key` to the character it composes (⌥C is 'ç'),
      // and it must come before the plain copy below, which on Windows/Linux
      // would otherwise claim Ctrl+Alt+C.
      if (mod && e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        if (ids.length) copyStyle(editor, ids);
        return;
      }
      if (mod && e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        if (ids.length) pasteStyle(editor, ids);
        return;
      }
      if (mod && !e.altKey && e.key === 'c') {
        if (ids.length) {
          copyShapes(editor, ids);
          void writeShapesToOsClipboard(editor, ids, clipboardToken());
        }
        return;
      }
      if (mod && e.key === 'x') {
        if (ids.length) {
          copyShapes(editor, ids);
          void writeShapesToOsClipboard(editor, ids, clipboardToken());
          const cut = ids.filter((id) => !editor.getShape(id)?.locked);
          deleteShapesWithCleanup(editor, cut);
          useSelectionStore.getState().clear();
        }
        return;
      }

      // Zoom (anchored at the viewport center).
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'in', s.baseZoom));
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'out', s.baseZoom));
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        useCameraStore.getState().zoomAtScreen(centerRef.current, 1);
        return;
      }
      // Shift+1 frames the page, Shift+2 the selection. Matched on `code`
      // because Shift rewrites `key` to whatever the layout puts above the digit
      // ('@' above 2 on US, '"' on UK).
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit1') {
        e.preventDefault();
        onZoomToFit();
        return;
      }
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit2') {
        e.preventDefault();
        onZoomToSelection();
        return;
      }

      // Arrow-key nudge (Shift = coarse). Skips locked shapes.
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        if (!ids.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const moveIds = moveTargetIds(editor.getShapes(), ids);
        // Held arrow keys auto-repeat, and `moveIds` expands a selected
        // container to its whole subtree, so scanning `ids` from inside the loop
        // made a large selection quadratic on every repeat.
        const selectedIds = new Set(ids);
        editor.transact(() => {
          for (const id of moveIds) {
            const s = editor.getShape(id);
            // Locked descendants still follow an unlocked selected container;
            // locking protects direct edits, not the parent's transform.
            if (s && (!s.locked || !selectedIds.has(id))) {
              editor.updateShape(id, { x: s.x + dx, y: s.y + dy });
            }
          }
        });
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Never delete locked shapes; deleting a container takes its children.
        const unlocked = ids.filter((id) => !editor.getShape(id)?.locked);
        const deletable = deleteTargetIds(editor.getShapes(), unlocked);
        if (deletable.length) {
          e.preventDefault();
          deleteShapesWithCleanup(editor, deletable);
          useSelectionStore.getState().clear();
        }
        return;
      }
      if ((e.key === 'Enter' || e.key === 'F2') && ids.length === 1) {
        const shape = editor.getShape(ids[0]!);
        if (shape?.type === 'frame' && !shape.locked) {
          e.preventDefault();
          useFrameEditingStore.getState().start(shape.id);
          return;
        }
        if (shape?.type === 'text' && !shape.locked) {
          e.preventDefault();
          useTextEditingStore.getState().start(shape.id, {
            anchor: shape.props.text.length,
            head: shape.props.text.length,
          });
          return;
        }
        if (shape?.type === 'equation' && !shape.locked) {
          e.preventDefault();
          requestEquationFocus(shape.id);
          return;
        }
      }
      if (e.key === 'Escape') {
        // Escape mid-press abandons the press and nothing else, so the
        // selection the drag began from survives it.
        if (arbiter.endToolGestureNow('cancel')) return;
        useEnteredGroupStore.getState().exit();
        useSelectionStore.getState().clear();
        useToolStore.getState().setTool('select');
        return;
      }
      if (mod || e.altKey) return;
      // Hold Z to arm Quick Zoom — the press that follows aims the camera
      // rather than using the tool. No tool claims this key, so nothing is
      // shadowed; Cmd/Ctrl+Z has already returned above as undo.
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        arbiter.quickZoomArmed = true;
        return;
      }
      // Shape Lock: toggle the lock on the current selection. Must precede the
      // hotkey lookup, since byHotkey('L') would otherwise match the Line tool.
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        if (ids.length) {
          const allLocked = ids.every((id) => editor.getShape(id)?.locked);
          editor.transact(() => {
            for (const id of ids)
              editor.updateShape(id, { locked: !allLocked });
          });
        }
        return;
      }
      // Flip. Like Shape Lock above, these must precede the hotkey lookup: the
      // bare keys belong to the Hand and Select tools.
      if (e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        if (ids.length) flipShapes(editor, ids, 'horizontal');
        return;
      }
      if (e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        if (ids.length) flipShapes(editor, ids, 'vertical');
        return;
      }
      // 1–8 pick the toolbar's first eight colours, left to right; [ and ] step the
      // stroke weight. Matched on `code` so a non-US layout keeps the digits.
      const digit = /^Digit([1-8])$/.exec(e.code);
      if (digit && !e.shiftKey) {
        const swatch = rampColors(
          useStyleStore.getState().ramp,
          useThemeStore.getState().theme,
        )[Number(digit[1]) - 1];
        if (swatch) {
          e.preventDefault();
          applyColor(swatch.value);
        }
        return;
      }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        stepSize(e.key === '[' ? -1 : 1);
        return;
      }
      // Tool Lock: keep the active creation tool after placing a shape.
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        useToolLockStore.getState().toggle();
        return;
      }
      const tool = toolRegistry.byHotkey(e.key);
      if (tool) {
        e.preventDefault();
        // Auto-repeat while a key is held is not a second press: re-arming on
        // it would record the borrowed tool as the one to return to.
        if (e.repeat) return;
        const from = useToolStore.getState().activeToolId;
        // Switching away mid-press keeps what the press made so far.
        if (from !== tool.id) arbiter.endToolGestureNow('commit');
        // Pressing the active tool's own key borrows nothing.
        arbiter.armSpring(
          from === tool.id
            ? null
            : {
                key: e.key.toLowerCase(),
                from,
                to: tool.id,
                at: e.timeStamp,
                used: false,
              },
        );
        useToolStore.getState().setTool(tool.id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'z' || e.key === 'Z') {
        arbiter.quickZoomArmed = false;
        // Letting go of the key mid-frame lands on the frame, same as letting
        // go of the pointer would.
        arbiter.endQuickZoom(arbiter.pointer);
      }
      arbiter.releaseSpring(e);
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta') return;
      toolRegistry.get(useToolStore.getState().activeToolId)?.onKeyUp?.(e, ctx);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [ctx, arbiter, centerRef, onZoomToFit, onZoomToSelection]);
}
