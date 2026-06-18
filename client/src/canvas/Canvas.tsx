import { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import './shapes/register';
import './tools/register';
import { Background } from './Background';
import { CanvasControls } from './CanvasControls';
import {
  cameraToTransform,
  nextDiscreteZoom,
  screenToWorld,
} from './camera';
import { viewportWorldBounds } from './geometry';
import { CursorsLayer } from '@/collab/CursorsLayer';
import { setLocalCursor, setLocalViewport } from '@/collab/presence';
import {
  stopFollowingForManualCameraChange,
  useFollowStore,
} from '@/collab/use-follow-store';
import { usePresenceStore } from '@/collab/use-presence-store';
import { ShapeView } from './ShapeView';
import { FrameView } from './shapes/frame';
import { SelectionLayer } from './SelectionLayer';
import { TextEditorOverlay } from './TextEditorOverlay';
import { toolRegistry } from './tools/tool-registry';
import type { ToolContext, ToolPointerInfo } from './tools/types';
import { duplicateShapes, groupShapes, ungroupShapes } from './commands';
import { copyShapes, pasteShapes } from './clipboard';
import { deleteTargetIds } from './hierarchy';
import { placeImageFiles } from './place-image';
import { useEnteredGroupStore } from './use-entered-group-store';
import {
  compareIndex,
  editor,
  redo,
  setCurrentPage,
  spatialIndex,
  undo,
  useDocumentStore,
} from './use-document-store';
import { shapeRegistry } from './shapes/shape-registry';
import { useCameraStore } from './use-camera-store';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { useElementSize } from './use-element-size';
import { useSafariGestures } from './use-safari-gestures';
import { isSelectable } from './selectable';
import { resolveOpacity } from './opacity';
import { useEraserStore } from './use-eraser-store';
import { useHiddenStore } from './use-hidden-store';
import { useSelectionStore } from './use-selection-store';
import { useSpacePan } from './use-space-pan';
import { useTextEditingStore } from './use-text-editing-store';
import { useToolStore } from './use-tool-store';
import { useToolLockStore } from './use-tool-lock-store';
import { useTouchPinch } from './use-touch-pinch';
import { useWheel } from './use-wheel';
import {
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
} from './z-order';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable)
  );
}

function isTouchPointer(e: ReactPointerEvent): boolean {
  return e.pointerType === 'touch';
}

export function Canvas() {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const camera = useCameraStore((s) => s.camera);
  const peers = usePresenceStore((s) => s.peers);
  const following = useFollowStore((s) => s.following);
  const lastSummonApplied = useFollowStore((s) => s.lastSummonApplied);
  const background = useCanvasUiStore((s) => s.background);
  const setBackground = useCanvasUiStore((s) => s.setBackground);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const pan = useSpacePan();
  useWheel(containerRef);
  useTouchPinch(containerRef);
  useSafariGestures(containerRef);

  // Which gesture owns the current pointer interaction.
  const gesture = useRef<'pan' | 'tool' | null>(null);
  // The pointer currently driving `gesture` (so stray pointers are ignored).
  const toolPointerId = useRef<number | null>(null);
  // Live touch pointers on the surface — drives single- vs multi-touch routing.
  const activeTouches = useRef<Set<number>>(new Set());
  // A pen (Apple Pencil) is down: finger touches are palm-rejected while it is.
  const penActive = useRef(false);
  // Latched once ≥2 fingers touch, cleared only when all lift — suppresses tool
  // routing for the rest of a pinch so lifting one finger never draws a stray mark.
  const pinchLatch = useRef(false);
  // Long-press → context menu (touch has no right-click).
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  // Live viewport center (screen px), read by keyboard zoom shortcuts.
  const centerRef = useRef({ x: 0, y: 0 });
  centerRef.current = { x: size.width / 2, y: size.height / 2 };

  const ctx = useMemo<ToolContext>(
    () => ({
      editor,
      setTool: useToolStore.getState().setTool,
      complete: () => {
        if (!useToolLockStore.getState().locked) {
          useToolStore.getState().setTool('select');
        }
      },
    }),
    [],
  );

  const editingId = useTextEditingStore((s) => s.editingId);
  const hidden = useHiddenStore((s) => s.hidden);
  const erasing = useEraserStore((s) => s.marked);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const shapesRecord = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );
  const shapes = useMemo(
    () => Object.values(shapesRecord ?? {}).sort(compareIndex),
    [shapesRecord],
  );

  const viewport =
    size.width > 0 ? viewportWorldBounds(camera, size.width, size.height) : null;
  const visibleIds = viewport ? new Set(spatialIndex.search(viewport)) : null;
  const visibleShapes = (
    visibleIds ? shapes.filter((s) => visibleIds.has(s.id)) : shapes
  ).filter((s) => s.id !== editingId && !hidden[s.id]);

  // Frame children render inside their frame's clip (recursively), so they are
  // excluded from the flat top-level pass.
  const hasFrameAncestor = (s: { parentId?: string | null }): boolean => {
    let cur = s.parentId ? shapesRecord?.[s.parentId] : undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      if (cur.type === 'frame') return true;
      seen.add(cur.id);
      cur = cur.parentId ? shapesRecord?.[cur.parentId] : undefined;
    }
    return false;
  };
  const childrenSorted = (parentId: string) =>
    Object.values(shapesRecord ?? {})
      .filter((s) => s.parentId === parentId && s.id !== editingId && !hidden[s.id])
      .sort(compareIndex);
  // Resolved render opacity per shape: ancestor compounding + any eraser dim.
  const opacityOf = (shape: (typeof shapes)[number]): number =>
    resolveOpacity(
      shape,
      (id) => shapesRecord?.[id],
      (id) => !!erasing[id],
    );
  const renderShape = (shape: (typeof shapes)[number]): ReactNode =>
    shape.type === 'frame' ? (
      <FrameView key={shape.id} frame={shape} opacity={opacityOf(shape)}>
        {childrenSorted(shape.id).map(renderShape)}
      </FrameView>
    ) : (
      <ShapeView key={shape.id} shape={shape} opacity={opacityOf(shape)} />
    );
  const topLevelShapes = visibleShapes.filter((s) => !hasFrameAncestor(s));

  const editingShape = editingId ? shapesRecord?.[editingId] : undefined;
  const tutorPeer = useMemo(() => peers.find((peer) => peer.isTutor), [peers]);
  const tutorClientId = tutorPeer?.clientId ?? null;
  const tutorViewport = tutorPeer?.viewport ?? null;
  const tutorSummon = tutorPeer?.summon ?? null;
  const tutorPage = tutorPeer?.page ?? null;
  const summonBaselineReady = useRef(false);

  const toInfo = useCallback(
    (e: ReactPointerEvent | ReactMouseEvent): ToolPointerInfo => {
      const rect = containerRef.current?.getBoundingClientRect();
      const screen = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      };
      const pointerType =
        'pointerType' in e && typeof e.pointerType === 'string'
          ? e.pointerType
          : 'mouse';
      const rawPressure = 'pressure' in e ? e.pressure : 0.5;
      const pressure =
        Number.isFinite(rawPressure) && rawPressure > 0 ? rawPressure : 0.5;
      return {
        point: screenToWorld(screen, useCameraStore.getState().camera),
        pressure,
        pointerType,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        button: e.button,
      };
    },
    [containerRef],
  );

  const activeTool = () => toolRegistry.get(useToolStore.getState().activeToolId);

  // True only for events that originate on the canvas DOM surface — excludes
  // in-canvas floating UI (data-ui-layer) and portaled popups/dialogs, whose
  // React events still bubble here but aren't DOM descendants of the canvas.
  const isSurfaceEvent = useCallback(
    (target: EventTarget | null): boolean => {
      const node = target as HTMLElement | null;
      if (!node || !containerRef.current?.contains(node)) return false;
      return !node.closest('[data-ui-layer]');
    },
    [containerRef],
  );

  // End the active tool/pan gesture, either committing it (the pointer lifted
  // normally) or cancelling it (a pinch/pen stole the interaction).
  const endToolGesture = useCallback(
    (target: Element, mode: 'cancel') => {
      const id = toolPointerId.current;
      if (gesture.current === 'tool' && mode === 'cancel') {
        activeTool()?.onCancel?.(ctx);
      }
      if (id !== null && target.hasPointerCapture(id)) {
        target.releasePointerCapture(id);
      }
      gesture.current = null;
      toolPointerId.current = null;
    },
    [ctx],
  );

  const startToolGesture = useCallback(
    (e: ReactPointerEvent) => {
      gesture.current = 'tool';
      toolPointerId.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      activeTool()?.onPointerDown?.(toInfo(e), ctx);
    },
    [toInfo, ctx],
  );

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
  }, []);

  // Arm a long-press on a one-finger touch: holding still for ~500ms aborts the
  // in-progress stroke and opens the context menu (touch has no right-click).
  // Dispatching a native `contextmenu` lets the existing onContextMenu select the
  // shape and the ContextMenuTrigger open — no duplicated logic.
  const armLongPress = useCallback(
    (e: ReactPointerEvent) => {
      const cx = e.clientX;
      const cy = e.clientY;
      const target = e.currentTarget;
      longPressOrigin.current = { x: cx, y: cy };
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null;
        longPressOrigin.current = null;
        endToolGesture(target, 'cancel');
        const el = document.elementFromPoint(cx, cy) ?? target;
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            view: window,
          }),
        );
      }, 500);
    },
    [endToolGesture],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      // Touch: drive the active tool with one finger; two fingers = pinch/pan.
      if (isTouchPointer(e)) {
        if (penActive.current) return; // palm rejection while the pen is down
        activeTouches.current.add(e.pointerId);
        if (activeTouches.current.size >= 2) {
          // Second finger down → a pinch is starting: abort the one-finger stroke
          // (useTouchPinch owns the camera from here) and mute tool routing.
          pinchLatch.current = true;
          clearLongPress();
          endToolGesture(e.currentTarget, 'cancel');
          return;
        }
        if (pinchLatch.current) return; // mid-pinch: wait until all fingers lift
        if (!isSurfaceEvent(e.target)) return;
        startToolGesture(e);
        armLongPress(e);
        return;
      }

      // Mouse / pen.
      if (!isSurfaceEvent(e.target)) return;
      if (e.pointerType === 'pen') {
        penActive.current = true;
        // A resting finger may have started a stroke first; the pen takes over.
        if (gesture.current === 'tool' && toolPointerId.current !== e.pointerId) {
          endToolGesture(e.currentTarget, 'cancel');
        }
      }
      if (pan.isSpaceDown) {
        stopFollowingForManualCameraChange();
        gesture.current = 'pan';
        toolPointerId.current = e.pointerId;
        pan.onPointerDown(e);
        return;
      }
      startToolGesture(e);
    },
    [pan, isSurfaceEvent, endToolGesture, startToolGesture],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (isTouchPointer(e) && penActive.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      // Skip the presence cursor while pinching (two fingers, jittery midpoint).
      if (rect && !(isTouchPointer(e) && pinchLatch.current)) {
        const world = screenToWorld(
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
          useCameraStore.getState().camera,
        );
        setLocalCursor(world);
      }
      // A real drag past the slop cancels the pending long-press.
      if (longPressOrigin.current) {
        const dx = e.clientX - longPressOrigin.current.x;
        const dy = e.clientY - longPressOrigin.current.y;
        if (Math.hypot(dx, dy) > 10) clearLongPress();
      }
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'pan') {
        pan.onPointerMove(e);
      } else if (gesture.current === 'tool') {
        activeTool()?.onPointerMove?.(toInfo(e), ctx);
      }
    },
    [pan, toInfo, ctx, containerRef, clearLongPress],
  );

  const releaseTouch = useCallback(
    (e: ReactPointerEvent) => {
      clearLongPress();
      if (e.pointerType === 'pen') penActive.current = false;
      if (isTouchPointer(e)) {
        activeTouches.current.delete(e.pointerId);
        if (activeTouches.current.size === 0) pinchLatch.current = false;
      }
    },
    [clearLongPress],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      releaseTouch(e);
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'pan') {
        pan.onPointerUp(e);
      } else if (gesture.current === 'tool') {
        activeTool()?.onPointerUp?.(toInfo(e), ctx);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }
      gesture.current = null;
      toolPointerId.current = null;
    },
    [pan, toInfo, ctx, releaseTouch],
  );

  // The browser fires pointercancel when it steals a touch (e.g. a pinch is
  // recognized) — abort the in-progress gesture rather than committing it.
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      releaseTouch(e);
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'pan') {
        pan.onPointerUp(e);
        gesture.current = null;
        toolPointerId.current = null;
      } else {
        endToolGesture(e.currentTarget, 'cancel');
      }
    },
    [pan, releaseTouch, endToolGesture],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (pan.isSpaceDown || !isSurfaceEvent(e.target)) return;
      activeTool()?.onDoubleClick?.(toInfo(e), ctx);
    },
    [pan, toInfo, ctx, isSurfaceEvent],
  );

  // Right-click selects the shape under the cursor (so the context menu acts on
  // it). Does not preventDefault — the context menu opens normally.
  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (!isSurfaceEvent(e.target)) return;
      const info = toInfo(e);
      const tol = 4 / useCameraStore.getState().camera.z;
      const shapes = editor.getShapes();
      const isHidden = useHiddenStore.getState().isHidden;
      let hitId: string | null = null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i]!;
        // Right-click can target locked shapes (to unlock them) but not hidden.
        if (isHidden(s.id)) continue;
        if (shapeRegistry.getFor(s)?.hitTest(s, info.point, tol)) {
          hitId = s.id;
          break;
        }
      }
      const sel = useSelectionStore.getState();
      if (hitId && !sel.selectedIds.includes(hitId)) sel.setSelection([hitId]);
      else if (!hitId) sel.clear();
    },
    [toInfo, isSurfaceEvent],
  );

  // Clear selection whenever we leave the select tool.
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    setLocalViewport(camera, size);
  }, [camera, size.width, size.height]);

  useEffect(() => {
    if (!following) return;
    if (tutorClientId === null) {
      useFollowStore.getState().setFollowing(false);
      return;
    }
    // Follow the tutor across pages, then mirror their viewport.
    if (tutorPage && tutorPage !== currentPageId) setCurrentPage(tutorPage);
    if (!tutorViewport || size.width <= 0 || size.height <= 0) return;
    const bounds = viewportWorldBounds(
      tutorViewport.camera,
      tutorViewport.size.width,
      tutorViewport.size.height,
    );
    useCameraStore.getState().zoomToBounds(bounds, size.width, size.height, 1);
  }, [
    following,
    tutorClientId,
    tutorViewport,
    tutorPage,
    currentPageId,
    size.width,
    size.height,
  ]);

  useEffect(() => {
    if (tutorClientId === null) {
      summonBaselineReady.current = false;
      return;
    }
    if (!summonBaselineReady.current) {
      if (tutorSummon !== null) {
        useFollowStore.getState().setLastSummonApplied(tutorSummon);
      }
      summonBaselineReady.current = true;
      return;
    }
    if (
      tutorSummon === null ||
      tutorSummon <= lastSummonApplied ||
      !tutorViewport ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      return;
    }
    // A summon yanks you to the tutor's page as well as their viewport.
    if (tutorPage && tutorPage !== currentPageId) setCurrentPage(tutorPage);
    const bounds = viewportWorldBounds(
      tutorViewport.camera,
      tutorViewport.size.width,
      tutorViewport.size.height,
    );
    useCameraStore.getState().zoomToBounds(bounds, size.width, size.height, 1);
    useFollowStore.getState().setLastSummonApplied(tutorSummon);
  }, [
    tutorClientId,
    tutorSummon,
    tutorViewport,
    tutorPage,
    currentPageId,
    lastSummonApplied,
    size.width,
    size.height,
  ]);

  useEffect(() => {
    if (activeToolId !== 'select') useSelectionStore.getState().clear();
  }, [activeToolId]);

  // Drop any pending long-press timer on unmount.
  useEffect(() => clearLongPress, [clearLongPress]);

  // Tool lifecycle: enter the active tool, and run the previous tool's onExit on
  // switch (the effect cleanup). Lets a tool tear down in-progress state — e.g.
  // the eraser cancels its pending stroke when you switch away or press Escape.
  useEffect(() => {
    const tool = toolRegistry.get(activeToolId);
    tool?.onEnter?.(ctx);
    return () => tool?.onExit?.(ctx);
  }, [activeToolId, ctx]);

  // Keyboard: selection ops, z-order, delete, escape, and tool hotkeys.
  // (Full configurable shortcut sweep is Phase 27.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const ids = useSelectionStore.getState().selectedIds;

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
          useSelectionStore.getState().setSelection(duplicateShapes(editor, ids));
        }
        return;
      }
      if (mod && e.key === 'a') {
        e.preventDefault();
        useSelectionStore
          .getState()
          .setSelection(
            editor.getShapes().filter(isSelectable).map((s) => s.id),
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
      // Clipboard.
      if (mod && e.key === 'c') {
        if (ids.length) copyShapes(editor, ids);
        return;
      }
      if (mod && e.key === 'x') {
        if (ids.length) {
          copyShapes(editor, ids);
          const cut = ids.filter((id) => !editor.getShape(id)?.locked);
          editor.deleteShapes(cut);
          useSelectionStore.getState().clear();
        }
        return;
      }
      if (mod && e.key === 'v') {
        e.preventDefault();
        const pasted = pasteShapes(editor);
        if (pasted.length) useSelectionStore.getState().setSelection(pasted);
        return;
      }

      // Zoom (anchored at the viewport center).
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'in'));
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'out'));
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        useCameraStore.getState().zoomAtScreen(centerRef.current, 1);
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
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        for (const id of ids) {
          const s = editor.getShape(id);
          if (s && !s.locked) editor.updateShape(id, { x: s.x + dx, y: s.y + dy });
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Never delete locked shapes; deleting a container takes its children.
        const unlocked = ids.filter((id) => !editor.getShape(id)?.locked);
        const deletable = deleteTargetIds(editor.getShapes(), unlocked);
        if (deletable.length) {
          e.preventDefault();
          editor.deleteShapes(deletable);
          useSelectionStore.getState().clear();
        }
        return;
      }
      if (e.key === 'Escape') {
        useEnteredGroupStore.getState().exit();
        useSelectionStore.getState().clear();
        useToolStore.getState().setTool('select');
        return;
      }
      if (mod || e.altKey) return;
      // Shape Lock: toggle the lock on the current selection. Must precede the
      // hotkey lookup, since byHotkey('L') would otherwise match the Line tool.
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        if (ids.length) {
          const allLocked = ids.every((id) => editor.getShape(id)?.locked);
          for (const id of ids) editor.updateShape(id, { locked: !allLocked });
        }
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
        useToolStore.getState().setTool(tool.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Paste images from the clipboard (placed at the viewport center).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const list = e.clipboardData?.items;
      const files: File[] = [];
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const item = list[i]!;
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }
      if (!files.length) return;
      e.preventDefault();
      const world = screenToWorld(
        centerRef.current,
        useCameraStore.getState().camera,
      );
      void placeImageFiles(files, world).then((ids) => {
        if (ids.length) {
          useToolStore.getState().setTool('select');
          useSelectionStore.getState().setSelection(ids);
        }
      });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Drag-and-drop image files onto the canvas (placed at the drop point).
  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/'),
      );
      if (!files.length) return;
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      const world = screenToWorld(
        { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) },
        useCameraStore.getState().camera,
      );
      void placeImageFiles(files, world).then((ids) => {
        if (ids.length) {
          useToolStore.getState().setTool('select');
          useSelectionStore.getState().setSelection(ids);
        }
      });
    },
    [containerRef],
  );

  // Zoom controls.
  const center = useCallback(
    () => ({ x: size.width / 2, y: size.height / 2 }),
    [size.width, size.height],
  );
  const onZoomIn = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    s.zoomAtScreen(center(), nextDiscreteZoom(s.camera.z, 'in'));
  }, [center]);
  const onZoomOut = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    s.zoomAtScreen(center(), nextDiscreteZoom(s.camera.z, 'out'));
  }, [center]);
  const onZoomReset = useCallback(() => {
    stopFollowingForManualCameraChange();
    useCameraStore.getState().zoomAtScreen(center(), 1);
  }, [center]);
  const onZoomToFit = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    const bounds = spatialIndex.totalBounds();
    if (!bounds) s.reset();
    else s.zoomToBounds(bounds, size.width, size.height);
  }, [size.width, size.height]);

  const toolCursor = toolRegistry.get(activeToolId)?.cursor ?? 'default';
  const cursor = pan.isPanning
    ? 'grabbing'
    : pan.isSpaceDown
      ? 'grab'
      : toolCursor;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-background"
      style={{ touchAction: 'none', cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerLeave={() => {
        setLocalCursor(null);
      }}
    >
      <Background
        type={background}
        camera={camera}
        width={size.width}
        height={size.height}
      />

      <svg className="absolute inset-0 h-full w-full">
        <g transform={cameraToTransform(camera)}>
          {topLevelShapes.map(renderShape)}
        </g>
      </svg>

      <SelectionLayer camera={camera} />
      <CursorsLayer camera={camera} />

      {editingShape?.type === 'text' && (
        <TextEditorOverlay shape={editingShape} camera={camera} />
      )}

      <CanvasControls
        zoom={camera.z}
        background={background}
        onBackgroundChange={setBackground}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onZoomToFit={onZoomToFit}
      />
    </div>
  );
}
