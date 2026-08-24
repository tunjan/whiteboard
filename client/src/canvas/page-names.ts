/**
 * Resolve `name` against `existingNames` so no two pages on a board share a
 * label. Suffixes are reused rather than stacked, so duplicating "Notes 2"
 * yields "Notes 3" instead of "Notes 2 1".
 *
 * A trailing number is recognized both bare ("Notes 2") and parenthesized
 * ("Notes (2)"), and the bracket style is preserved when incrementing.
 */
export function getIncrementedName(
  name: string,
  existingNames: Iterable<string>,
): string {
  const taken = new Set(existingNames);
  if (!taken.has(name)) return name;

  // Split once: everything after the trailing counter is regenerated below, so
  // repeated collisions walk 2, 3, 4... instead of appending a suffix per pass.
  const match = /^(.*?) \((\d+)\)$/.exec(name) ?? /^(.*?) (\d+)$/.exec(name);
  const stem = match?.[1] ?? name;
  const parenthesized = match ? name.endsWith(')') : false;
  let counter = match ? Number.parseInt(match[2]!, 10) : 0;

  let candidate = name;
  while (taken.has(candidate)) {
    counter++;
    candidate = parenthesized ? `${stem} (${counter})` : `${stem} ${counter}`;
  }
  return candidate;
}
