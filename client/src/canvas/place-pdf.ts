import { genId, type Point, type Shape } from '@whiteboard/shared';
import { uploadImageBlob, uploadImageThumb } from '../board/blobs';
import { toast } from '@/components/ui/toast';
import { shortFileName } from '@/lib/utils';
import { getTopIndex, jitterKeyBetween } from './order';
import { openPdf, type PdfPageRaster } from './pdf-render';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { breakUndoCapture, editor } from './use-document-store';
import { requestPageRange } from './use-pdf-import-store';

/** The one MIME type this path claims, from both the clipboard and a drop. */
export const PDF_MIME = 'application/pdf';

/** Vertical space between two pages of the same document, in world units. */
const PDF_PAGE_GAP = 24;
const DONE_TIMEOUT_MS = 2_000;

/** A page, sized and positioned, ready to become a shape. */
interface PlacedPage extends PdfPageRaster {
  blobId: string;
  thumbBlobId?: string;
  x: number;
  y: number;
}

/**
 * Rasterize PDFs and place their pages on the board as image shapes, stacked in
 * a column centred on `at`. Returns the new shape ids; as with
 * `placeImageFiles`, the caller decides what to select.
 *
 * Documents are handled one at a time: rendering holds a page bitmap and its
 * PNG in memory at once, and doing that for several files in parallel is how a
 * tab runs out of it.
 */
export async function placePdfFiles(
  files: File[],
  at: Point,
): Promise<string[]> {
  const ids: string[] = [];
  let origin = at;
  for (const file of files) {
    const placed = await importOnePdf(file, origin);
    ids.push(...placed);
    // Cascade a second document off the first rather than burying it.
    if (placed.length) origin = { x: origin.x + 40, y: origin.y + 40 };
  }
  return ids;
}

async function importOnePdf(file: File, at: Point): Promise<string[]> {
  const title = shortFileName(file.name);
  let pdf;
  try {
    pdf = await openPdf(file);
  } catch (err) {
    toast.add({
      title,
      description:
        err instanceof Error ? err.message : 'That PDF could not be opened.',
      type: 'error',
    });
    return [];
  }

  try {
    const limit = useCanvasUiStore.getState().pdfPageLimit;
    const range =
      pdf.pageCount <= limit
        ? { from: 1, to: pdf.pageCount }
        : await requestPageRange({
            fileName: file.name,
            pageCount: pdf.pageCount,
            limit,
          });
    if (!range) return [];

    const total = range.to - range.from + 1;
    const progress = toast.add({
      title,
      description: `Importing ${total === 1 ? 'the page' : `${total} pages`}…`,
      // A 'loading' toast carries no dismiss timer, so it stays up until the
      // import turns it into the result.
      type: 'loading',
    });

    // Every page is rendered and uploaded before anything is written to the
    // document. Creating the shapes first would flash a column of empty frames
    // onto every collaborator's canvas while the rasterizing caught up.
    const rasters: Array<
      PdfPageRaster & { blobId: string; thumbBlobId?: string }
    > = [];
    for (let page = range.from; page <= range.to; page++) {
      const done = page - range.from;
      toast.update(progress, {
        description: `Importing page ${done + 1} of ${total}…`,
        data: { progress: done / total },
      });
      try {
        const raster = await pdf.renderPage(page);
        const [blobId, thumbBlobId] = await Promise.all([
          uploadImageBlob(raster.blob, 'image/png'),
          uploadImageThumb(raster.blob, raster.rasterW, raster.rasterH),
        ]);
        rasters.push({ ...raster, blobId, thumbBlobId });
      } catch (err) {
        // One bad page should not cost the reader the other nineteen.
        console.error('[pdf] page %d failed', page, err);
      }
    }

    if (!rasters.length) {
      toast.update(progress, {
        description: 'None of those pages could be imported.',
        type: 'error',
      });
      return [];
    }
    if (rasters.length < total) {
      toast.update(progress, {
        description: `${total - rasters.length} of ${total} pages could not be imported.`,
        type: 'warning',
      });
    } else {
      toast.update(progress, {
        description: total === 1 ? 'Page added' : `${total} pages added`,
        timeout: DONE_TIMEOUT_MS,
        type: 'success',
      });
    }

    return createPageShapes(pdfColumnLayout(rasters, at));
  } finally {
    void pdf.destroy();
  }
}

/**
 * Stack pages top to bottom and centre the whole column on `at`, so a paste
 * lands where the pointer is however many pages it turns out to be. Pure, and
 * exported for its test.
 */
export function pdfColumnLayout<T extends { worldW: number; worldH: number }>(
  pages: T[],
  at: Point,
): Array<T & { x: number; y: number }> {
  const height =
    pages.reduce((sum, p) => sum + p.worldH, 0) +
    PDF_PAGE_GAP * Math.max(0, pages.length - 1);

  let y = at.y - height / 2;
  return pages.map((page) => {
    const placed = { ...page, x: at.x - page.worldW / 2, y };
    y += page.worldH + PDF_PAGE_GAP;
    return placed;
  });
}

function createPageShapes(pages: PlacedPage[]): string[] {
  breakUndoCapture();
  // Seeded before the transaction on purpose: inside one, `getShapes()` is
  // served from a cache that cannot see the transaction's own writes, so asking
  // for the top index per page would hand every page the same key.
  let index = getTopIndex(editor.getShapes());
  const shapes = pages.map((page) => {
    const shape = {
      id: genId(),
      type: 'image',
      x: page.x,
      y: page.y,
      rotation: 0,
      index,
      props: {
        blobId: page.blobId,
        w: page.worldW,
        h: page.worldH,
        naturalWidth: page.rasterW,
        naturalHeight: page.rasterH,
        ...(page.thumbBlobId ? { thumbBlobId: page.thumbBlobId } : {}),
      },
    } as Shape;
    index = jitterKeyBetween(index, null);
    return shape;
  });

  // One transaction: one undo step, one snapshot rebuild, and peers never see a
  // half-imported document.
  editor.transact(() => {
    for (const shape of shapes) editor.createShape(shape);
  });
  return shapes.map((s) => s.id);
}
