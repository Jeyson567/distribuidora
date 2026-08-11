/**
 * Firestore only needs a composite index when a query filters on one field and
 * orders by another. Listings therefore filter on the server and order here,
 * which keeps the application working against a fresh project where nobody has
 * created indexes yet. Result sets are bounded by `limit`, so sorting in memory
 * costs nothing measurable.
 */

/** Accepts Firestore Timestamps, Dates, epoch numbers and ISO strings. */
export function toMillis(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Ordering by a field on the server silently hides documents that lack it, so
 * catalogues are ordered here: a record saved without its search key still
 * shows up in the list instead of disappearing.
 */
export function sortByText(records, field) {
  return [...records].sort((a, b) => {
    const left = String(a?.[field] ?? '');
    const right = String(b?.[field] ?? '');
    if (!left) return right ? 1 : 0;
    if (!right) return -1;
    return left.localeCompare(right, 'es');
  });
}

export function sortByDate(records, field, direction = 'desc') {
  const factor = direction === 'asc' ? 1 : -1;
  return [...records].sort((a, b) => {
    const left = toMillis(a?.[field]);
    const right = toMillis(b?.[field]);
    if (left === right) return 0;
    // Records without a usable date go last whichever way we are sorting.
    if (left === null) return 1;
    if (right === null) return -1;
    return left < right ? -factor : factor;
  });
}
