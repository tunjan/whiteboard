import { useEffect, useRef } from 'react';
import type { TextShape } from '@whiteboard/shared';
import { setLocalTextSelection } from '@/collab/presence';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import { deleteShapesWithCleanup } from './commands';
import { inkPaint } from './ink-color';
import {
  fontStack,
  fontWeight,
  layoutTextProps,
  stabilizeTextPosition,
  textInkMargin,
} from './shapes/text-measure';
import { editor } from './use-document-store';
import { useSelectionStore } from './use-selection-store';
import { useTextEditingStore } from './use-text-editing-store';
import { useToolStore } from './use-tool-store';

/**
 * Native editing half of the text tool's dual renderer. The SVG shape is
 * removed while this textarea is mounted, so browsers own caret movement,
 * selections, clipboard behavior, spellcheck, undo, and IME composition.
 */
export function TextEditorOverlay({
  shape,
  camera,
}: {
  shape: TextShape;
  camera: Camera;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const mountedAt = useRef(0);
  const composing = useRef(false);
  const stop = useTextEditingStore((state) => state.stop);
  const requestedAnchor = useTextEditingStore((state) => state.anchor);
  const requestedHead = useTextEditingStore((state) => state.head);
  const layout = layoutTextProps(shape.props);
  const fixed = layout.mode === 'fixed';

  const publishSelection = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    setLocalTextSelection({
      shapeId: shape.id,
      anchor: element.selectionStart ?? 0,
      head: element.selectionEnd ?? element.selectionStart ?? 0,
    });
  };

  // Seed content and the mapped caret after the pointer event that created or
  // opened the editor has released capture from the canvas.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.value = shape.props.text;
    mountedAt.current = Date.now();
    const frame = requestAnimationFrame(() => {
      element.focus({ preventScroll: true });
      const fallback = shape.props.text.length;
      const anchor = Math.max(
        0,
        Math.min(shape.props.text.length, requestedAnchor ?? fallback),
      );
      const head = Math.max(
        0,
        Math.min(shape.props.text.length, requestedHead ?? anchor),
      );
      element.setSelectionRange(Math.min(anchor, head), Math.max(anchor, head));
      publishSelection(element);
    });
    return () => {
      cancelAnimationFrame(frame);
      setLocalTextSelection(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // A Y.Text update from a peer can arrive while this native editor is open.
  // Apply it imperatively without turning the textarea into a controlled input
  // (which would reset IME/caret state on every local keystroke).
  useEffect(() => {
    const element = ref.current;
    if (!element || composing.current || element.value === shape.props.text) return;
    const start = Math.min(element.selectionStart ?? 0, shape.props.text.length);
    const end = Math.min(element.selectionEnd ?? start, shape.props.text.length);
    element.value = shape.props.text;
    element.setSelectionRange(start, end);
  }, [shape.props.text]);

  /**
   * Write new text, moving the box so that the edge the alignment anchors to
   * stays put. Without this, every keystroke in a centred or right-aligned
   * auto-sizing text would slide the whole line sideways.
   */
  const writeText = (value: string) => {
    const { x, y } = stabilizeTextPosition(shape, { ...shape.props, text: value });
    editor.updateShape(shape.id, { x, y, props: { text: value } });
  };

  const commit = () => {
    const value = ref.current?.value ?? shape.props.text;
    setLocalTextSelection(null);
    if (value.trim() === '') {
      deleteShapesWithCleanup(editor, [shape.id]);
      useSelectionStore.getState().clear();
    } else {
      writeText(value);
      useSelectionStore.getState().setSelection([shape.id]);
    }
    stop();
    useToolStore.getState().setTool('select');
  };

  const screen = worldToScreen(shape, camera);
  const zoom = camera.z;
  const fontSize = shape.props.fontSize * zoom;

  // The textarea hides its overflow at exactly the measured box, which clips
  // the swashes and descenders a script face throws past its advance width.
  // Grow the element outward and pad it back in by the same amount, so the ink
  // survives while the glyphs stay exactly where the SVG renderer puts them.
  // Auto-sizing only: in a fixed-width box the element's content width is the
  // wrap boundary, and padding it would wrap at a different point than layout.
  const ink = fixed ? 0 : textInkMargin(fontSize);

  return (
    <textarea
      ref={ref}
      data-ui-layer
      aria-label="Edit text"
      defaultValue={shape.props.text}
      wrap={fixed ? 'soft' : 'off'}
      spellCheck
      autoCapitalize="sentences"
      onInput={(event) => {
        writeText(event.currentTarget.value.replace(/\r\n?/g, '\n'));
        publishSelection(event.currentTarget);
      }}
      onSelect={(event) => publishSelection(event.currentTarget)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        writeText(event.currentTarget.value.replace(/\r\n?/g, '\n'));
        publishSelection(event.currentTarget);
      }}
      onBlur={() => {
        // Focus juggling around the creating click can emit one immediate blur.
        if (Date.now() - mountedAt.current < 180) {
          requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          commit();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="absolute z-[var(--z-canvas-front)] m-0 block resize-none overflow-hidden border-0 bg-transparent outline-none"
      style={{
        left: screen.x - ink,
        top: screen.y - ink,
        width: layout.width * zoom + ink * 2,
        height: layout.height * zoom + ink * 2,
        minWidth: layout.width * zoom + ink * 2,
        minHeight: layout.height * zoom + ink * 2,
        padding: ink,
        boxSizing: 'border-box',
        fontFamily: fontStack(shape.props.fontFamily),
        fontWeight: fontWeight(shape.props.fontWeight),
        fontSize,
        // The engine has already quantized this; re-deriving it from the
        // multiplier here would let the two representations round apart.
        lineHeight: `${layout.lineHeight * zoom}px`,
        textAlign:
          shape.props.align === 'middle'
            ? 'center'
            : shape.props.align === 'end'
              ? 'right'
              : 'left',
        whiteSpace: fixed ? 'pre-wrap' : 'pre',
        overflowWrap: fixed ? 'anywhere' : 'normal',
        color: inkPaint(shape.props.color),
        caretColor: 'currentColor',
        transform: shape.rotation ? `rotate(${shape.rotation}rad)` : undefined,
        transformOrigin: 'center center',
        boxShadow: fixed
          ? 'inset 0 0 0 1px var(--action-solid, #3b82f6)'
          : undefined,
        opacity: shape.opacity ?? 1,
      }}
    />
  );
}
