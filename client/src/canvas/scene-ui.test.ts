import { afterEach, describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import type { SceneUi } from './engine/scene';
import { resetPageInteractionStates } from './page-interaction-state';
import {
  bindSceneUi,
  deriveSceneUi,
  isShapeInteractionActive,
  subscribeShapeInteraction,
  type SceneUiInput,
} from './scene-ui';
import { useEraserStore } from './use-eraser-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { useHiddenStore } from './use-hidden-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { beginLiveStroke, endLiveStroke } from './use-live-stroke-store';
import { useSelectionStore } from './use-selection-store';
import { useTextEditingStore } from './use-text-editing-store';
import { useVideoPlayingStore } from './use-video-playing-store';

const idle: SceneUiInput = {
  selectedIds: [],
  hidden: {},
  erasing: {},
  editing: null,
  frame: null,
  cropping: null,
  playing: null,
  live: null,
  liveIsHighlight: false,
};

const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe('deriveSceneUi', () => {
  const cases: {
    name: string;
    input: Partial<SceneUiInput>;
    suppressed: string[];
    pinned: string[];
  }[] = [
    { name: 'nothing going on', input: {}, suppressed: [], pinned: [] },
    {
      name: 'a selection stays resident but is still drawn',
      input: { selectedIds: ['a', 'b'] },
      suppressed: [],
      pinned: ['a', 'b'],
    },
    {
      name: 'text being edited is drawn by the editor',
      input: { editing: 't' },
      suppressed: ['t'],
      pinned: ['t'],
    },
    {
      name: 'an image being cropped is drawn by the crop overlay',
      input: { cropping: 'i' },
      suppressed: ['i'],
      pinned: ['i'],
    },
    {
      name: 'a playing video is drawn by the player',
      input: { playing: 'v' },
      suppressed: ['v'],
      pinned: ['v'],
    },
    {
      name: 'a frame whose title is edited stays drawn and resident',
      input: { frame: 'f' },
      suppressed: [],
      pinned: ['f'],
    },
    {
      name: 'a live pen stroke is drawn by the live layer',
      input: { live: 's' },
      suppressed: ['s'],
      pinned: ['s'],
    },
    {
      name: 'a live highlighter keeps its scene pass',
      input: { live: 's', liveIsHighlight: true },
      suppressed: [],
      pinned: ['s'],
    },
    {
      name: 'everything at once',
      input: {
        selectedIds: ['a'],
        editing: 't',
        frame: 'f',
        cropping: 'i',
        playing: 'v',
        live: 's',
      },
      suppressed: ['i', 's', 't', 'v'],
      pinned: ['a', 'f', 'i', 's', 't', 'v'],
    },
  ];

  it.each(cases)('$name', ({ input, suppressed, pinned }) => {
    const ui = deriveSceneUi({ ...idle, ...input });
    expect(sorted(ui.suppressed)).toEqual(suppressed);
    expect(sorted(ui.pinned)).toEqual(pinned);
  });

  it('hands hidden and erasing through by reference', () => {
    const hidden = { a: true };
    const erasing = { b: true };
    const ui = deriveSceneUi({ ...idle, hidden, erasing });
    expect(ui.hidden).toBe(hidden);
    expect(ui.erasing).toBe(erasing);
  });
});

describe('bound to the interaction stores', () => {
  afterEach(() => {
    endLiveStroke();
    resetPageInteractionStates();
    useHiddenStore.setState({ hidden: {} });
  });

  function bind(getShape: (id: string) => Shape | undefined = () => undefined) {
    const published: SceneUi[] = [];
    const stop = bindSceneUi({ setUi: (ui) => published.push(ui) }, getShape);
    return { published, stop, last: () => published.at(-1)! };
  }

  it('publishes at once, then on every change it depends on', () => {
    useSelectionStore.getState().setSelection(['a']);
    const { published, last, stop } = bind();
    expect(published).toHaveLength(1);
    expect(sorted(last().pinned)).toEqual(['a']);

    useTextEditingStore.getState().start('t');
    expect(sorted(last().suppressed)).toEqual(['t']);

    useFrameEditingStore.getState().start('f');
    expect(sorted(last().pinned)).toEqual(['a', 'f', 't']);

    useEraserStore.setState({ marked: { a: true } });
    expect(last().erasing).toEqual({ a: true });

    useHiddenStore.setState({ hidden: { a: true } });
    expect(last().hidden).toEqual({ a: true });
    stop();
  });

  it('ignores selection store changes that leave the selection alone', () => {
    const { published, stop } = bind();
    useSelectionStore.getState().setMarquee(null);
    useSelectionStore.getState().setSnapGuides([]);
    expect(published).toHaveLength(1);
    stop();
  });

  it('asks for the live shape to tell highlighter from pen', () => {
    const highlight = {
      type: 'draw',
      props: { inkKind: 'highlight' },
    } as unknown as Shape;
    const { last, stop } = bind((id) => (id === 'h' ? highlight : undefined));

    beginLiveStroke('h');
    expect(sorted(last().suppressed)).toEqual([]);
    expect(sorted(last().pinned)).toEqual(['h']);
    endLiveStroke();

    beginLiveStroke('p');
    expect(sorted(last().suppressed)).toEqual(['p']);
    stop();
  });

  it('stops publishing once detached', () => {
    const { published, stop } = bind();
    stop();
    useTextEditingStore.getState().start('t');
    expect(published).toHaveLength(1);
  });
});

describe('the shape the user is inside', () => {
  afterEach(() => resetPageInteractionStates());

  it.each([
    ['editing text', () => useTextEditingStore.getState().start('x')],
    ['editing a frame title', () => useFrameEditingStore.getState().start('x')],
    ['cropping', () => useImageCroppingStore.getState().start('x')],
    ['playing a video', () => useVideoPlayingStore.getState().start('x')],
  ])('is active while %s, and announced', (_name, enter) => {
    let heard = 0;
    const stop = subscribeShapeInteraction(() => heard++);
    expect(isShapeInteractionActive()).toBe(false);
    enter();
    expect(isShapeInteractionActive()).toBe(true);
    expect(heard).toBe(1);
    stop();
  });

  it('is let go of, all of it, when the board or page is left', () => {
    useTextEditingStore.getState().start('t');
    useFrameEditingStore.getState().start('f');
    useImageCroppingStore.getState().start('i');
    useVideoPlayingStore.getState().start('v');

    resetPageInteractionStates();
    expect(isShapeInteractionActive()).toBe(false);
  });
});
