import type { Shape } from '@whiteboard/shared';
import { setLocalTextSelection } from '@/collab/presence';
import { useCommentsStore } from './use-comments-store';
import { useEnteredGroupStore } from './use-entered-group-store';
import { useEraserStore } from './use-eraser-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useLaserStore } from './use-laser-store';
import { useSelectionStore } from './use-selection-store';
import { useTextEditingStore } from './use-text-editing-store';
import { useVideoPlayingStore } from './use-video-playing-store';

interface PageInteractionState {
  selectedIds: string[];
  enteredGroupId: string | null;
  textEditing: {
    id: string;
    anchor: number | null;
    head: number | null;
  } | null;
}

const pageStates = new Map<string, PageInteractionState>();

/** Save the durable interaction context, then clear state that cannot cross pages. */
export function leavePageInteractionState(pageId: string): void {
  const selection = useSelectionStore.getState();
  const enteredGroupId = useEnteredGroupStore.getState().enteredGroupId;
  const textEditing = useTextEditingStore.getState();

  pageStates.set(pageId, {
    selectedIds: [...selection.selectedIds],
    enteredGroupId,
    textEditing: textEditing.editingId
      ? {
          id: textEditing.editingId,
          anchor: textEditing.anchor,
          head: textEditing.head,
        }
      : null,
  });

  selection.clear();
  selection.setMarquee(null);
  selection.setSnapGuides([]);
  useEnteredGroupStore.getState().exit();
  useTextEditingStore.getState().stop();
  setLocalTextSelection(null);
  useImageCroppingStore.getState().stop();
  useVideoPlayingStore.getState().stop();
  useEraserStore.getState().clear();

  const laser = useLaserStore.getState();
  for (const stroke of laser.strokes) laser.discard(stroke.id);

  const comments = useCommentsStore.getState();
  comments.setOpenThreadId(null);
  comments.setDraft(null);
}

/** Restore only ids that still belong to the newly active page. */
export function enterPageInteractionState(
  pageId: string,
  getShape: (id: string) => Shape | undefined,
): void {
  const saved = pageStates.get(pageId);
  if (!saved) return;

  const selectedIds = saved.selectedIds.filter((id) => Boolean(getShape(id)));
  const enteredGroupId =
    saved.enteredGroupId && getShape(saved.enteredGroupId)?.type === 'group'
      ? saved.enteredGroupId
      : null;
  const editingShape = saved.textEditing
    ? getShape(saved.textEditing.id)
    : undefined;
  const textEditing = editingShape?.type === 'text' ? saved.textEditing : null;

  pageStates.set(pageId, { selectedIds, enteredGroupId, textEditing });
  useSelectionStore.getState().setSelection(selectedIds);
  if (enteredGroupId) useEnteredGroupStore.getState().enter(enteredGroupId);
  if (textEditing) {
    const selection =
      textEditing.anchor === null
        ? undefined
        : {
            anchor: textEditing.anchor,
            head: textEditing.head ?? undefined,
          };
    useTextEditingStore.getState().start(textEditing.id, selection);
  }
}

export function deletePageInteractionState(pageId: string): void {
  pageStates.delete(pageId);
}

/** Board sessions never share local interaction state. */
export function resetPageInteractionStates(): void {
  pageStates.clear();
  useSelectionStore.getState().clear();
  useSelectionStore.getState().setMarquee(null);
  useSelectionStore.getState().setSnapGuides([]);
  useEnteredGroupStore.getState().exit();
  useTextEditingStore.getState().stop();
  useImageCroppingStore.getState().stop();
  useVideoPlayingStore.getState().stop();
  useEraserStore.getState().clear();
  const laser = useLaserStore.getState();
  for (const stroke of laser.strokes) laser.discard(stroke.id);
}
