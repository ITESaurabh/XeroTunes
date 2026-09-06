export type SortDir = 'asc' | 'desc';

/** `key` of null means library order: whatever the query returned. */
export interface SortState {
  key: string | null;
  dir: SortDir;
}

/**
 * Titles like "Track 2" and "Track 10" have to come out in that order, and a
 * case-only difference must not split two spellings of the same artist apart.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const isBlank = (v: unknown): boolean => v == null || v === '';

/**
 * Blanks sink to the bottom in *both* directions; a screenful of missing years
 * is never the answer someone wanted from clicking a header.
 */
export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  if (isBlank(a) || isBlank(b)) {
    if (isBlank(a) && isBlank(b)) return 0;
    return isBlank(a) ? 1 : -1;
  }
  const raw =
    typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
  return dir === 'asc' ? raw : -raw;
}

/**
 * Sorts a copy. Array#sort is stable, so equal rows keep library order and
 * repeated toggles never shuffle ties around.
 */
export function sortRows<T>(rows: T[], getValue: (_row: T) => unknown, dir: SortDir): T[] {
  return rows.slice().sort((a, b) => compareValues(getValue(a), getValue(b), dir));
}

/** Header clicks cycle asc → desc → off, so library order stays reachable. */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, dir: 'asc' };
  return current.dir === 'asc' ? { key, dir: 'desc' } : { key: null, dir: 'asc' };
}

export type FilterOp =
  | 'contains'
  | 'equals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty';

export interface TableFilter {
  key: string;
  op: FilterOp;
  value: string;
}

/** `needsValue: false` operators ignore the text box, so the UI can hide it. */
export const FILTER_OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'equals', label: 'equals', needsValue: true },
  { value: 'startsWith', label: 'starts with', needsValue: true },
  { value: 'endsWith', label: 'ends with', needsValue: true },
  { value: 'isEmpty', label: 'is empty', needsValue: false },
  { value: 'isNotEmpty', label: 'is not empty', needsValue: false },
];

export const opNeedsValue = (op: FilterOp): boolean =>
  FILTER_OPS.find(o => o.value === op)?.needsValue ?? true;

/**
 * Filtering and search both run on the text a cell displays, not the raw
 * property, otherwise "3:13" would not match a duration and a formatted date
 * would not match what is on screen.
 */
export function matchesFilter(text: string, op: FilterOp, value: string): boolean {
  const hay = text.toLowerCase();
  const needle = value.trim().toLowerCase();
  switch (op) {
    case 'isEmpty':
      return text === '';
    case 'isNotEmpty':
      return text !== '';
    case 'equals':
      return hay === needle;
    case 'startsWith':
      return hay.startsWith(needle);
    case 'endsWith':
      return hay.endsWith(needle);
    case 'contains':
      return hay.includes(needle);
  }
}

/** An empty query matches everything, so the caller can pass state straight through. */
export function matchesSearch(texts: string[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return texts.some(t => t.toLowerCase().includes(needle));
}
