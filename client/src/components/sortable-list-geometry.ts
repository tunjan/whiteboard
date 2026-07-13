export function shiftedSortableIndex(
  index: number,
  startIndex: number,
  targetIndex: number,
): number {
  if (index === startIndex) return index;
  if (targetIndex < startIndex && index >= targetIndex && index < startIndex) {
    return index + 1;
  }
  if (targetIndex > startIndex && index > startIndex && index <= targetIndex) {
    return index - 1;
  }
  return index;
}
