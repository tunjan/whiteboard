import { create } from 'zustand';

export interface PdfPageRange {
  /** 1-based, inclusive on both ends. */
  from: number;
  to: number;
}

export interface PdfRangeRequest {
  fileName: string;
  pageCount: number;
  /** Most pages that may be placed in one import. */
  limit: number;
}

interface PendingRequest extends PdfRangeRequest {
  settle: (range: PdfPageRange | null) => void;
}

interface PdfImportStore {
  /** The request the dialog is currently showing, if any. */
  pending: PendingRequest | null;
  /** Answer the open request. `null` cancels the import. */
  resolve: (range: PdfPageRange | null) => void;
}

export const usePdfImportStore = create<PdfImportStore>()((set, get) => ({
  pending: null,
  resolve: (range) => {
    const { pending } = get();
    if (!pending) return;
    set({ pending: null });
    pending.settle(range);
  },
}));

/**
 * Ask the user which pages to import, and wait for the answer.
 *
 * The import runs in a plain async function, not a component, so the dialog is
 * driven the other way round from the rest of the app's dialogs: the caller
 * awaits a promise and `<PdfRangeDialog />` — mounted once in the board — is
 * what settles it. Resolves `null` when the user cancels.
 *
 * Imports are sequential, so there is only ever one request outstanding; a
 * second one arriving would cancel the first rather than queue behind it.
 */
export function requestPageRange(
  request: PdfRangeRequest,
): Promise<PdfPageRange | null> {
  return new Promise((settle) => {
    const { pending } = usePdfImportStore.getState();
    pending?.settle(null);
    usePdfImportStore.setState({ pending: { ...request, settle } });
  });
}
