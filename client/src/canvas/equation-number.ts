/** A tag that is a plain number, the only kind auto-numbering counts. */
const NUMERIC = /^\d+$/;

/**
 * The tag a newly created equation gets when auto-numbering is on: the next
 * free number if it has none, or if it carries a number already on the page (a
 * duplicate or a paste). An emptied tag (`''`) and a name are the author's
 * choice and are kept.
 *
 * Assigned once, at creation, and stored — numbers never shift under a student
 * who was just told to look at (3).
 */
export function autoEquationTag(
  tag: string | undefined,
  existing: Iterable<string | undefined>,
): string {
  if (tag !== undefined && !NUMERIC.test(tag)) return tag;
  let max = 0;
  let taken = false;
  for (const other of existing) {
    if (!other || !NUMERIC.test(other)) continue;
    max = Math.max(max, Number(other));
    if (other === tag) taken = true;
  }
  return tag === undefined || taken ? String(max + 1) : tag;
}
