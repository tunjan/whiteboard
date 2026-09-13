import { create } from 'zustand';
import { useConnectionStore } from '@/collab/use-connection-store';
import {
  BOARD_READY_DEADLINE_MS,
  type BoardLoadStage,
  type BoardReadinessInputs,
  boardLoadStage,
  isBoardReady,
} from './board-readiness';

/**
 * Whether the board being joined is ready to be shown, for the loading veil and
 * for everything that must not shout over a board still arriving.
 *
 * A leaf store on purpose. `use-document-store.ts` already imports the latency
 * monitor from `@/collab/latency`, and the monitor has to read this — so parking
 * it on the document store would close an import cycle.
 */

interface BoardLoadingStore {
  ready: boolean;
  stage: BoardLoadStage;
}

export const useBoardLoadingStore = create<BoardLoadingStore>(() => ({
  ready: false,
  stage: 'local',
}));

const NOTHING_SYNCED: BoardReadinessInputs = {
  localSynced: false,
  remoteSynced: false,
  pageSettled: false,
  pageSynced: false,
  offline: false,
  deadlinePassed: false,
};

let inputs: BoardReadinessInputs = NOTHING_SYNCED;

export function updateBoardLoading(patch: Partial<BoardReadinessInputs>): void {
  // Ready is one-way within a load: a disconnect later on must never raise the
  // veil again over a board the user is already working on.
  if (useBoardLoadingStore.getState().ready) return;
  inputs = { ...inputs, ...patch };
  useBoardLoadingStore.setState({
    ready: isBoardReady(inputs),
    stage: boardLoadStage(inputs),
  });
}

/**
 * Start one board's load. The disposer must run before the next one begins.
 *
 * `initial` says which sources this board actually has, mirroring the readiness
 * flags in `loadBoard`: a source the board does not have is a source it never
 * has to wait for.
 */
export function beginBoardLoad(initial: {
  localSynced: boolean;
  remoteSynced: boolean;
}): () => void {
  inputs = { ...NOTHING_SYNCED, ...initial };
  useBoardLoadingStore.setState({ ready: false, stage: 'local' });

  const unsubscribe = useConnectionStore.subscribe((state) =>
    updateBoardLoading({ offline: state.status === 'disconnected' }),
  );
  const deadline = setTimeout(
    () => updateBoardLoading({ deadlinePassed: true }),
    BOARD_READY_DEADLINE_MS,
  );
  // Re-evaluate the seed itself, so a board with no configured source at all
  // (tests, in-memory boards) does not sit behind the veil waiting for an event
  // that will never come.
  updateBoardLoading({});

  return () => {
    clearTimeout(deadline);
    unsubscribe();
    inputs = NOTHING_SYNCED;
    // Reset rather than leave it true: otherwise the next board's first frame
    // paints as ready, which is a flash of an empty canvas.
    useBoardLoadingStore.setState({ ready: false, stage: 'local' });
  };
}
