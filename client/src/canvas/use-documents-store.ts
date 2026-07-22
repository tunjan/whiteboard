import { create } from 'zustand';
import type { BoardDocumentMeta } from '@whiteboard/shared';

/** An upload in flight (or failed) on this client only. Peers see the file
 *  once it lands in the Yjs `documents` map. */
export interface PendingUpload {
  id: string;
  name: string;
  size: number;
  /** 0–1, driven by XHR upload progress. */
  progress: number;
  /** User-facing failure reason; null while the upload is healthy. */
  error: string | null;
}

interface DocumentsStore {
  /** Mirror of the Yjs `documents` map, keyed by document id. */
  documents: Record<string, BoardDocumentMeta>;
  setDocuments: (documents: Record<string, BoardDocumentMeta>) => void;
  /** Local-only upload rows, keyed by a temporary id. */
  uploads: Record<string, PendingUpload>;
  startUpload: (upload: PendingUpload) => void;
  updateUpload: (id: string, patch: Partial<PendingUpload>) => void;
  clearUpload: (id: string) => void;
  /** Whether the documents popover is open. Lets a canvas file drop reveal it. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  reset: () => void;
}

export const useDocumentsStore = create<DocumentsStore>((set) => ({
  documents: {},
  setDocuments: (documents) => set({ documents }),
  uploads: {},
  startUpload: (upload) =>
    set((s) => ({ uploads: { ...s.uploads, [upload.id]: upload } })),
  updateUpload: (id, patch) =>
    set((s) => {
      const current = s.uploads[id];
      if (!current) return s;
      return { uploads: { ...s.uploads, [id]: { ...current, ...patch } } };
    }),
  clearUpload: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.uploads;
      return { uploads: rest };
    }),
  panelOpen: false,
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  reset: () => set({ documents: {}, uploads: {}, panelOpen: false }),
}));
