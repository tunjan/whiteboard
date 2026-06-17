import { useEffect, useRef } from 'react';
import type { TextShape } from '@whiteboard/shared';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import { LINE_HEIGHT_FACTOR, fontStack } from './shapes/text-measure';
import { editor } from './use-document-store';
import { useTextEditingStore } from './use-text-editing-store';
import { useToolStore } from './use-tool-store';

/** Normalize contentEditable text (drop a trailing newline browsers add). */
function readText(el: HTMLElement): string {
  return el.innerText.replace(/\n$/, '');
}

/**
 * HTML editing overlay for a text shape. Shown only while editing; the shape's
 * SVG text is hidden underneath. Writes live back into the document so content
 * persists, and deletes the shape if committed empty.
 */
export function TextEditorOverlay({
  shape,
  camera,
}: {
  shape: TextShape;
  camera: Camera;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mountedAt = useRef(0);
  const stop = useTextEditingStore((s) => s.stop);

  // Seed content + caret once on mount. The DOM text is managed imperatively
  // (no children prop) so re-renders never reset the caret.
  //
  // Focus is deferred to the next frame: the creating pointerdown/click on the
  // canvas (which holds pointer capture) would otherwise steal focus from the
  // overlay the instant it mounts. By the next frame that interaction is done.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = shape.props.text;
    mountedAt.current = Date.now();
    const raf = requestAnimationFrame(() => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const commit = () => {
    const el = ref.current;
    const text = el ? readText(el) : '';
    if (text.trim() === '') editor.deleteShapes([shape.id]);
    else editor.updateShape(shape.id, { props: { text } });
    stop();
    useToolStore.getState().setTool('select');
  };

  const onInput = () => {
    const el = ref.current;
    if (el) editor.updateShape(shape.id, { props: { text: readText(el) } });
  };

  const onBlur = () => {
    // Ignore the spurious blur right after mount (focus juggling around the
    // creating click) — re-focus instead of committing an empty editor.
    if (Date.now() - mountedAt.current < 250) {
      requestAnimationFrame(() => ref.current?.focus());
      return;
    }
    commit();
  };

  const screen = worldToScreen(shape, camera);
  const fontPx = shape.props.fontSize * camera.z;
  const textAlign =
    shape.props.align === 'middle'
      ? 'center'
      : shape.props.align === 'end'
        ? 'right'
        : 'left';

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Edit text"
      onInput={onInput}
      onBlur={onBlur}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          commit();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute whitespace-pre outline-none"
      style={{
        left: screen.x,
        top: screen.y,
        fontFamily: fontStack(shape.props.fontFamily),
        fontSize: fontPx,
        lineHeight: LINE_HEIGHT_FACTOR,
        textAlign,
        color: shape.props.color,
        transformOrigin: 'top left',
        minWidth: '1ch',
        caretColor: 'currentColor',
      }}
    />
  );
}
