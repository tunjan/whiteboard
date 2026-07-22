import {
  MAX_DOCUMENTS_PER_BOARD,
  MAX_DOCUMENT_BYTES,
  documentExtension,
  genId,
  type BoardDocumentMeta,
} from '@whiteboard/shared';
import {
  addBoardDocument,
  boardDocumentsFull,
} from '@/canvas/use-document-store';
import { useDocumentsStore } from '@/canvas/use-documents-store';

// Client for the board document repository. Unlike images (see ./blobs.ts)
// documents are never recompressed — a file must download byte-identical to
// what was uploaded.

/** URL for a stored document. `name` is echoed back in Content-Disposition. */
export function documentUrl(meta: BoardDocumentMeta): string {
  return `/api/docs/${meta.storageId}?name=${encodeURIComponent(meta.name)}`;
}

// Files for in-flight uploads, so a failed row can be retried and a running one
// aborted without keeping File/XHR objects in the store.
const pendingFiles = new Map<string, File>();
const pendingRequests = new Map<string, XMLHttpRequest>();

const TOO_LARGE = 'Too large — 10 MB max';
const UNSUPPORTED = 'Unsupported file type';
const UPLOAD_FAILED = 'Upload failed';
const REPOSITORY_FULL = `Repository is full (${MAX_DOCUMENTS_PER_BOARD} files max)`;
/** Sentinel: the user aborted, so the row is removed rather than shown failed. */
const CANCELLED = 'cancelled';

/**
 * Upload one file's bytes. Resolves with the content-addressed storage id.
 * Uses XHR rather than fetch so the 10 MB ceiling has a real progress bar.
 */
function uploadBytes(
  file: File,
  ext: string,
  uploadId: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    pendingRequests.set(uploadId, xhr);
    xhr.open('POST', `/api/docs?ext=${encodeURIComponent(ext)}`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const storageId = (xhr.response as { storageId?: string } | null)
        ?.storageId;
      if (xhr.status === 413) reject(new Error(TOO_LARGE));
      else if (xhr.status === 415) reject(new Error(UNSUPPORTED));
      else if (xhr.status >= 200 && xhr.status < 300 && storageId) {
        resolve(storageId);
      } else reject(new Error(UPLOAD_FAILED));
    };
    xhr.onerror = () => reject(new Error(UPLOAD_FAILED));
    xhr.onabort = () => reject(new Error(CANCELLED));
    xhr.send(file);
  });
}

async function runUpload(uploadId: string, uploaderName: string): Promise<void> {
  const store = useDocumentsStore.getState();
  const file = pendingFiles.get(uploadId);
  if (!file) return;

  // Checked client-side first so an oversized or unsupported file fails
  // instantly instead of after pushing 10 MB up a slow uplink.
  const ext = documentExtension(file.name);
  if (!ext) {
    store.updateUpload(uploadId, { error: UNSUPPORTED });
    return;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    store.updateUpload(uploadId, { error: TOO_LARGE });
    return;
  }
  if (boardDocumentsFull()) {
    store.updateUpload(uploadId, { error: REPOSITORY_FULL });
    return;
  }

  store.updateUpload(uploadId, { error: null, progress: 0 });
  try {
    const storageId = await uploadBytes(file, ext, uploadId, (progress) => {
      useDocumentsStore.getState().updateUpload(uploadId, { progress });
    });
    addBoardDocument({
      id: genId(),
      storageId,
      name: file.name,
      ext,
      size: file.size,
      uploadedBy: uploaderName,
      createdAt: Date.now(),
    } satisfies BoardDocumentMeta);
    forgetUpload(uploadId);
  } catch (error) {
    const message = error instanceof Error ? error.message : UPLOAD_FAILED;
    if (message === CANCELLED) forgetUpload(uploadId);
    else useDocumentsStore.getState().updateUpload(uploadId, { error: message });
  } finally {
    pendingRequests.delete(uploadId);
  }
}

function forgetUpload(uploadId: string): void {
  pendingFiles.delete(uploadId);
  pendingRequests.delete(uploadId);
  useDocumentsStore.getState().clearUpload(uploadId);
}

/**
 * Add files to the board's repository. Shared by the file picker, the panel's
 * drop zone, and the canvas drop handler.
 */
export function addFilesToRepository(
  files: File[],
  uploaderName: string,
): void {
  for (const file of files) {
    const uploadId = genId();
    pendingFiles.set(uploadId, file);
    useDocumentsStore.getState().startUpload({
      id: uploadId,
      name: file.name,
      size: file.size,
      progress: 0,
      error: null,
    });
    void runUpload(uploadId, uploaderName);
  }
}

/** Retry a failed upload row. */
export function retryUpload(uploadId: string, uploaderName: string): void {
  void runUpload(uploadId, uploaderName);
}

/** Abort an in-flight upload, or dismiss a failed row. */
export function cancelUpload(uploadId: string): void {
  const xhr = pendingRequests.get(uploadId);
  if (xhr) xhr.abort();
  else forgetUpload(uploadId);
}
