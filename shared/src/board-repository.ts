/** Board metadata. Board *content* lives in the Yjs doc, never here. */
export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * The home screen talks only to this interface, so the backing store can change
 * (local IndexedDB now → server REST in Phase 21) without touching the UI.
 * Governs the board *list/metadata* only.
 */
export interface BoardRepository {
  list(): Promise<BoardMeta[]>;
  get(id: string): Promise<BoardMeta | undefined>;
  create(name: string): Promise<BoardMeta>;
  rename(id: string, name: string): Promise<void>;
  delete(id: string): Promise<void>;
}
