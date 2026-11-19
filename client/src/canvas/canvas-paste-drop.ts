import { useCallback, useEffect, type DragEvent, type RefObject } from 'react';
import { hasFeature } from '@/board/features';
import { getLocalUser } from '@/collab/presence';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { addFilesToRepository } from '@/board/documents';
import { screenToWorld } from './camera';
import { isTypingTarget } from './canvas-shortcuts';
import {
  clipboardToken,
  hasClipboard,
  pasteShapes,
  wbClipToken,
} from './clipboard';
import { getContainerRect } from './container-rect';
import type { GestureArbiter } from './gesture-arbiter';
import { linkUrlsFromClipboard } from './link-url';
import { placeImageFiles } from './place-image';
import { placeLinkUrls } from './place-link';
import { PDF_MIME, placePdfFiles } from './place-pdf';
import {
  createYoutubeShape,
  isVideoFile,
  parseYoutubeId,
  placeVideoFiles,
} from './place-video';
import { getSelectionInfo } from './selection-geometry';
import { useCameraStore } from './use-camera-store';
import { breakUndoCapture, editor } from './use-document-store';
import { useDocumentsStore } from './use-documents-store';
import { useSelectionStore } from './use-selection-store';
import { useToolStore } from './use-tool-store';

/**
 * Frame freshly-placed images, so a paste or drop is looked at rather than left
 * as a stamp under the pointer. Takes the viewport rather than reading it so
 * callers can pass a ref's value and stay dependency-free.
 */
function zoomToPlaced(
  ids: string[],
  viewport: { width: number; height: number },
): void {
  const { width, height } = viewport;
  if (!ids.length || width <= 0 || height <= 0) return;
  const s = useCameraStore.getState();
  const info = getSelectionInfo(
    editor.getShapes(),
    ids,
    s.camera.z,
    editor.getShape,
  );
  if (!info) return;
  stopFollowingForManualCameraChange();
  s.animateToBounds(info.bounds, width, height);
}

export function useCanvasPasteAndDrop({
  arbiter,
  centerRef,
  sizeRef,
  containerRef,
}: {
  arbiter: GestureArbiter;
  /** Live viewport center (screen px); pastes land here when the pointer is off-canvas. */
  centerRef: RefObject<{ x: number; y: number }>;
  sizeRef: RefObject<{ width: number; height: number }>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  // The single paste path (Cmd+V). Prefers our own tagged copy (editable
  // shapes), then a clipboard image, PDF or video, then the in-app buffer as
  // a fallback. All pastes land at the pointer (viewport center when off-canvas).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const dt = e.clipboardData;
      const ours =
        hasClipboard() &&
        wbClipToken(dt?.getData('text/html') ?? '') === clipboardToken();

      const files: File[] = [];
      const pdfs: File[] = [];
      const videos: File[] = [];
      if (dt?.items) {
        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i]!;
          if (item.kind !== 'file') continue;
          const f = item.getAsFile();
          if (!f) continue;
          if (item.type.startsWith('image/')) files.push(f);
          else if (item.type === PDF_MIME) pdfs.push(f);
          else if (isVideoFile(f)) videos.push(f);
        }
      }

      const world = screenToWorld(
        arbiter.pointer ?? centerRef.current,
        useCameraStore.getState().camera,
      );
      const selectPasted = arbiter.selectPasted;

      if (ours) {
        e.preventDefault();
        selectPasted(pasteShapes(editor, world));
        return;
      }
      if (files.length) {
        e.preventDefault();
        // Its own undo step, matching pasted links below.
        breakUndoCapture();
        void placeImageFiles(files, world).then((ids) => {
          selectPasted(ids);
          zoomToPlaced(ids, sizeRef.current);
        });
        return;
      }
      if (pdfs.length) {
        e.preventDefault();
        void placePdfFiles(pdfs, world).then(selectPasted);
        return;
      }
      if (videos.length) {
        e.preventDefault();
        breakUndoCapture();
        void placeVideoFiles(videos, world).then(selectPasted);
        return;
      }
      const text = dt?.getData('text/plain') ?? '';
      // Pasted links become preview cards. `breakUndoCapture` makes the paste
      // its own undo step, so Ctrl+Z removes exactly what was just pasted.
      const urls = linkUrlsFromClipboard(text, dt?.getData('text/html') ?? '');
      if (urls && hasFeature('media')) {
        e.preventDefault();
        breakUndoCapture();
        selectPasted(placeLinkUrls(urls, world));
        return;
      }
      // A bare video id is not a URL, so it never matches the link path above.
      const youtubeId = parseYoutubeId(text);
      if (youtubeId && hasFeature('media')) {
        e.preventDefault();
        selectPasted([createYoutubeShape(youtubeId, world)]);
        return;
      }
      if (hasClipboard()) {
        e.preventDefault();
        selectPasted(pasteShapes(editor, world));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-and-drop files onto the canvas: images, PDFs and videos are placed at
  // the drop point, anything else goes to the board's document repository. A
  // dropped PDF matches a pasted one — it belongs under the pen, not behind a
  // drawer — and the repository's own upload button still takes one for filing.
  const onDragOver = useCallback((e: DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      const dropped = Array.from(e.dataTransfer.files);
      const images = dropped.filter((f) => f.type.startsWith('image/'));
      const pdfs = dropped.filter((f) => f.type === PDF_MIME);
      const videos = dropped.filter(isVideoFile);
      // Filed in the repository — unless the tutor turned it off here.
      const documents = hasFeature('documents')
        ? dropped.filter(
            (f) =>
              !f.type.startsWith('image/') && f.type !== PDF_MIME && !isVideoFile(f),
          )
        : [];
      if (!images.length && !pdfs.length && !videos.length && !documents.length)
        return;
      e.preventDefault();

      if (documents.length) {
        addFilesToRepository(documents, getLocalUser()?.name ?? 'Someone');
        // Reveal the repository so the file doesn't seem to vanish.
        useDocumentsStore.getState().setPanelOpen(true);
      }
      if (!images.length && !pdfs.length && !videos.length) return;

      const rect = getContainerRect(containerRef.current);
      const world = screenToWorld(
        { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) },
        useCameraStore.getState().camera,
      );
      const select = (ids: string[]) => {
        if (ids.length) {
          useToolStore.getState().setTool('select');
          useSelectionStore.getState().setSelection(ids);
        }
      };
      if (images.length)
        void placeImageFiles(images, world).then((ids) => {
          select(ids);
          zoomToPlaced(ids, sizeRef.current);
        });
      if (pdfs.length) void placePdfFiles(pdfs, world).then(select);
      if (videos.length) void placeVideoFiles(videos, world).then(select);
    },
    [containerRef, sizeRef],
  );

  return { onDragOver, onDrop };
}
