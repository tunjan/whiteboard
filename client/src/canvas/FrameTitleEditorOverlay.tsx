import { useEffect, useRef } from 'react';
import type { FrameShape } from '@whiteboard/shared';
import { worldToScreen } from './camera';
import { useCameraFollow } from './use-camera-interaction';
import {
  FRAME_HEADING_FONT_SCREEN,
  frameHeadingLayout,
} from './frame-geometry';
import { inkPaint } from './ink-color';
import { editor } from './use-document-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { useSelectionStore } from './use-selection-store';

/** Native, screen-space title editor for a frame heading. */
export function FrameTitleEditorOverlay({ shape }: { shape: FrameShape }) {
  const [camera, follow] = useCameraFollow<HTMLDivElement>();
  const ref = useRef<HTMLInputElement>(null);
  const initialName = useRef(shape.props.name);
  const stop = useFrameEditingStore((state) => state.stop);
  const layout = frameHeadingLayout(shape, camera.z);
  const origin = worldToScreen(layout.corners[0], camera);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true });
      ref.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = () => {
    const value = ref.current?.value.trim() || 'Frame';
    editor.updateShape(shape.id, { props: { name: value } });
    useSelectionStore.getState().setSelection([shape.id]);
    stop();
  };

  return (
    // The follower is a stacking context, so it carries the z-index.
    <div ref={follow} className="absolute top-0 left-0 z-[var(--z-canvas-front)]">
      <input
        ref={ref}
        data-ui-layer
        data-exact-size
        data-slot="frame-title-editor"
        aria-label="Edit frame title"
        defaultValue={shape.props.name}
        spellCheck
        autoCapitalize="sentences"
        onInput={(event) => {
          editor.updateShape(shape.id, {
            props: { name: event.currentTarget.value },
          });
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            editor.updateShape(shape.id, {
              props: { name: initialName.current },
            });
            stop();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute m-0 rounded-sm border border-focus bg-card px-1.5 py-0 text-foreground shadow-sm outline-none"
        style={{
          left: origin.x,
          top: origin.y,
          width: Math.max(32, layout.width * camera.z),
          height: layout.height * camera.z,
          boxSizing: 'border-box',
          fontFamily: "'Inter Variable', system-ui, sans-serif",
          fontSize: FRAME_HEADING_FONT_SCREEN,
          lineHeight: `${layout.height * camera.z}px`,
          transform: `rotate(${layout.pageRotation}rad)`,
          transformOrigin: '0 0',
          color: inkPaint(shape.props.color ?? 'var(--color-muted-foreground)'),
        }}
      />
    </div>
  );
}
