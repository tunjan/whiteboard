import type { Shape } from '@whiteboard/shared';
import type { SceneUi } from './engine/scene';
import { useEraserStore } from './use-eraser-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { useHiddenStore } from './use-hidden-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useLiveStrokeStore } from './use-live-stroke-store';
import { useSelectionStore } from './use-selection-store';
import { useTextEditingStore } from './use-text-editing-store';
import { useVideoPlayingStore } from './use-video-playing-store';

// What the interaction state means for the scene, derived once for every
// renderer: which shapes something else is drawing (suppressed), which must
// stay resident whatever the cull says (pinned), and which are hidden or
// marked for erasing. A renderer binds its scene here and then reads only the
// scene.

/**
 * The one shape of each kind the user is currently inside, if any. Each lives
 * in a store of its own; this is the single place they are read together.
 */
export interface ShapeInteraction {
  /** Text shape open in the inline editor. */
  editing: string | null;
  /** Frame whose title is being edited. */
  frame: string | null;
  /** Image being cropped. */
  cropping: string | null;
  /** Video playing inline. */
  playing: string | null;
  /** Stroke the local pointer is drawing. */
  live: string | null;
}

export function activeShapeInteraction(): ShapeInteraction {
  return {
    editing: useTextEditingStore.getState().editingId,
    frame: useFrameEditingStore.getState().editingId,
    cropping: useImageCroppingStore.getState().croppingId,
    playing: useVideoPlayingStore.getState().playingId,
    live: useLiveStrokeStore.getState().shapeId,
  };
}

/** Whether the user is inside any shape at all. */
export function isShapeInteractionActive(): boolean {
  const { editing, frame, cropping, playing, live } = activeShapeInteraction();
  return Boolean(editing || frame || cropping || playing || live);
}

/** Hear about any change to {@link activeShapeInteraction}. */
export function subscribeShapeInteraction(listener: () => void): () => void {
  const stops = [
    useTextEditingStore.subscribe(listener),
    useFrameEditingStore.subscribe(listener),
    useImageCroppingStore.subscribe(listener),
    useVideoPlayingStore.subscribe(listener),
    useLiveStrokeStore.subscribe(listener),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}

export interface SceneUiInput extends ShapeInteraction {
  selectedIds: readonly string[];
  hidden: Record<string, boolean>;
  erasing: Record<string, boolean>;
  /** Whether `live` is a highlighter stroke rather than pen ink. */
  liveIsHighlight: boolean;
}

/**
 * A live pen stroke is owned by the live layer and suppressed in the scene,
 * while a live highlighter keeps its underlay pass and loses only the overlay.
 * Whatever is being edited, cropped, played or drawn stays resident so culling
 * cannot unmount it, and so does the selection.
 */
export function deriveSceneUi(input: SceneUiInput): SceneUi {
  const { editing, frame, cropping, playing, live } = input;
  const suppressed = new Set(
    [editing, cropping, playing, input.liveIsHighlight ? null : live].filter(
      (id): id is string => !!id,
    ),
  );
  const pinned = new Set([...input.selectedIds, ...suppressed]);
  if (live) pinned.add(live);
  if (frame) pinned.add(frame);
  return {
    hidden: input.hidden,
    erasing: input.erasing,
    suppressed,
    pinned,
  };
}

interface UiScene {
  setUi(next: SceneUi): void;
}

/**
 * Publish the current interaction state to `scene`, and keep it current.
 * Returns the detach. `getShape` must see the live stroke, which is unpublished
 * until pointer-up — so the editor's, not the published store's.
 */
export function bindSceneUi(
  scene: UiScene,
  getShape: (id: string) => Shape | undefined,
): () => void {
  const sync = () => {
    const interaction = activeShapeInteraction();
    const liveShape = interaction.live ? getShape(interaction.live) : undefined;
    scene.setUi(
      deriveSceneUi({
        ...interaction,
        selectedIds: useSelectionStore.getState().selectedIds,
        hidden: useHiddenStore.getState().hidden,
        erasing: useEraserStore.getState().marked,
        liveIsHighlight:
          liveShape?.type === 'draw' && liveShape.props.inkKind === 'highlight',
      }),
    );
  };
  sync();
  const stops = [
    useSelectionStore.subscribe((next, prev) => {
      if (next.selectedIds !== prev.selectedIds) sync();
    }),
    useHiddenStore.subscribe(sync),
    useEraserStore.subscribe(sync),
    subscribeShapeInteraction(sync),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
