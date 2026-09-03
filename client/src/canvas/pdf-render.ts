import type { PDFDocumentProxy } from 'pdfjs-dist';

/**
 * The only module that knows about pdf.js.
 *
 * A PDF reaches the board as one raster image per page rather than as a shape
 * of its own: the pages are then ordinary `image` shapes, so drawing on them,
 * erasing, cropping, framing and PNG export all work without a line of new
 * code. The trade is resolution — a page is rendered once, at
 * `PDF_RASTER_SCALE`, and zooming past that shows pixels.
 */

/** Raster pixels per world unit. Two keeps 12pt body text sharp at 200% zoom. */
const PDF_RASTER_SCALE = 2;

/**
 * Ceiling on the long side of a page raster, mirroring the `maxWidthOrHeight`
 * the image upload path already applies. A0 posters and long receipts would
 * otherwise render to tens of megapixels and fail the 12 MB blob cap.
 */
const MAX_RASTER_PX = 2200;

export interface PdfPageRaster {
  /** PNG bytes, ready for `uploadImageBlob`. */
  blob: Blob;
  /** Page size in world units (PDF points, which are ~CSS pixels). */
  worldW: number;
  worldH: number;
  /** Size of `blob` in pixels — the shape's `naturalWidth`/`naturalHeight`. */
  rasterW: number;
  rasterH: number;
}

export interface PdfHandle {
  pageCount: number;
  /** Rasterize a 1-based page number. */
  renderPage(pageNumber: number): Promise<PdfPageRaster>;
  /** Tear down the document and its worker. Always call this. */
  destroy(): Promise<void>;
}

/**
 * Open a PDF for rasterizing. pdf.js is imported on demand — it is a megabyte
 * of parser that only a board someone actually pastes a PDF onto ever needs,
 * the same reasoning that keeps the image compressor out of the entry chunk.
 *
 * Rejects with a message fit for a toast when the file is encrypted or corrupt.
 */
export async function openPdf(file: File): Promise<PdfHandle> {
  const [pdfjs, { default: workerSrc }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  // pdf.js spawns and owns the worker itself. Handing it a shared port instead
  // would not survive the first import: destroying a document tears the port's
  // message handler down with it.
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Served from `public/pdfjs` by `scripts/copy-pdfjs-assets.mjs`, so a
    // self-hosted board serves them itself. pdf.js only asks for what a given
    // document uses: fonts it references but does not embed, CMaps for CJK
    // encodings, and the wasm decoders for the JBIG2/JPEG2000 images scanners
    // produce — which is most of the worksheets this feature exists for.
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    iccUrl: '/pdfjs/iccs/',
    wasmUrl: '/pdfjs/wasm/',
  });

  let pdf: PDFDocumentProxy;
  try {
    pdf = await task.promise;
  } catch (err) {
    void task.destroy();
    throw new Error(pdfOpenMessage(err));
  }

  return {
    pageCount: pdf.numPages,
    renderPage: (pageNumber) => renderPage(pdf, pageNumber),
    destroy: () => task.destroy(),
  };
}

async function renderPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<PdfPageRaster> {
  const page = await pdf.getPage(pageNumber);
  try {
    // Scale 1 is the page's own size in points, which the board treats as world
    // units — so a letter page lands at 612x792 and keeps document proportions.
    const base = page.getViewport({ scale: 1 });
    const longSide = PDF_RASTER_SCALE * Math.max(base.width, base.height);
    const scale = PDF_RASTER_SCALE * Math.min(1, MAX_RASTER_PX / longSide);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) {
      throw new Error(
        'This browser could not open a canvas to draw the page on.',
      );
    }

    // pdf.js paints the canvas white before it draws, so a page whose artwork
    // is not full-bleed still rasterizes opaque without help from here.
    await page.render({ canvas, canvasContext, viewport }).promise;

    return {
      blob: await canvasPng(canvas),
      worldW: base.width,
      worldH: base.height,
      rasterW: canvas.width,
      rasterH: canvas.height,
    };
  } finally {
    page.cleanup();
  }
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The page could not be encoded as an image.'));
    }, 'image/png');
  });
}

/** pdf.js throws tagged errors; turn the two a user can act on into prose. */
function pdfOpenMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'PasswordException') return 'That PDF is password-protected.';
  if (name === 'InvalidPDFException') return 'That file is not a readable PDF.';
  return 'That PDF could not be opened.';
}
