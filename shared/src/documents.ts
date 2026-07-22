/**
 * Metadata for one file in a board's document repository. This lives in the
 * Yjs doc (so it syncs live to every peer); the bytes live server-side at
 * `/api/docs/<storageId>`.
 */
export interface BoardDocumentMeta {
  /** Client-minted via genId(); the key in the Yjs `documents` map. */
  id: string;
  /** `<sha256>.<ext>` returned by the upload — content-addressed, so identical
   *  files uploaded to different boards share one stored copy. */
  storageId: string;
  /** Original filename, shown in the UI and used for the download name. */
  name: string;
  /** Validated extension. Drives the icon here and the mime type on the server. */
  ext: string;
  size: number;
  /** Display-only attribution (the uploader's presence name). */
  uploadedBy: string;
  createdAt: number;
}

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_NAME_LENGTH = 200;
/** Guards against a stray multi-file drop filling a board's drawer. */
export const MAX_DOCUMENTS_PER_BOARD = 100;

/**
 * Extension -> mime. The extension is authoritative: browsers report an empty
 * or `application/octet-stream` content-type for `.md`, `.csv`, and several
 * Office types, so the client sends the extension and the server derives the
 * mime from this table.
 *
 * `html` and `svg` are deliberately absent — like the image blob store, a
 * stored file must never be able to execute script when opened same-origin.
 */
export const DOCUMENT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
};

/** Types safe to render same-origin; everything else downloads as an attachment. */
export const INLINE_DOCUMENT_EXTS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
]);

/** The file's extension if it's an accepted type, else null. */
export function documentExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return DOCUMENT_MIME[ext] ? ext : null;
}
