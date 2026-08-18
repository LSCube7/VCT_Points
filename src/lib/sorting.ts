export function sortByDescending<T>(
  items: readonly T[],
  getValue: (item: T) => number,
  getId: (item: T) => string,
): T[] {
  return [...items].sort((left, right) => {
    if (getValue(left) === getValue(right)) return getId(left).localeCompare(getId(right));
    const valueDifference = getValue(right) - getValue(left);
    return valueDifference;
  });
}
