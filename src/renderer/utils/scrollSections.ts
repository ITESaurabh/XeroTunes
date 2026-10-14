/** A jump target on the scrollbar rail. `offset` is a scrollTop value. */
export interface ScrollSection {
  label: string;
  offset: number;
}

interface GridShape {
  rowHeight: number;
  /** 1 for a list; the column count for a card grid. */
  colCount?: number;
  /** Height of anything pinned above the first row inside the same scroller. */
  headerHeight?: number;
}

/**
 * First-letter index for an alphabetically sorted list or card grid. Only honest when
 * the list really is sorted by the label, so pass it for a title sort alone. Anything
 * not starting with a letter (digits, symbols, CJK) shares one "#" bucket.
 */
export function alphabetSections(
  labels: string[],
  { rowHeight, colCount = 1, headerHeight = 0 }: GridShape
): ScrollSection[] {
  if (rowHeight <= 0 || colCount < 1) return [];
  const sections: ScrollSection[] = [];
  let previous = '';
  labels.forEach((label, index) => {
    const first = (label?.trim()[0] ?? '#').toUpperCase();
    const bucket = first >= 'A' && first <= 'Z' ? first : '#';
    if (bucket === previous) return;
    previous = bucket;
    const offset = headerHeight + Math.floor(index / colCount) * rowHeight;
    // Two letters can start on the same grid row; the rail can only point at the
    // row, so it keeps the letter that row actually begins with.
    if (sections[sections.length - 1]?.offset === offset) return;
    sections.push({ label: bucket, offset });
  });
  return sections;
}
