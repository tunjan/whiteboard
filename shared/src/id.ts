import { nanoid } from 'nanoid';

/** Id for a shape (or other in-document entity). */
export function genId(): string {
  return nanoid();
}

/**
 * Unguessable id for a board's capability URL (`/board/:id`). Anyone with the
 * link can view/edit, so this is the security boundary — keep it long.
 */
export function genBoardId(): string {
  return nanoid(21);
}
