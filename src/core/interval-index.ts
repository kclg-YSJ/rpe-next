/** One indexed interval, carrying the original item and its position in the source array. */
export interface IndexedInterval<T> {
  item: T;
  index: number;
  start: number;
  end: number;
}

/** A node of the augmented interval tree, storing the largest `end` in its subtree. */
interface IntervalNode<T> {
  entry: IndexedInterval<T>;
  left: IntervalNode<T> | null;
  right: IntervalNode<T> | null;
  maxEnd: number;
}

/**
 * Interval tree over items with a `[start, end)` span, used to find what overlaps a beat range.
 *
 * The editor queries overlap constantly (notes under the cursor, events in view, hitsounds to
 * schedule), so the tree is built once per document and pruned by the subtree `maxEnd` to skip
 * subtrees that cannot match. Results come back in `start` order.
 */
export class IntervalIndex<T> {
  entries: IndexedInterval<T>[];
  root: IntervalNode<T> | null;

  constructor(items: readonly T[], start: (item: T) => number, end: (item: T) => number) {
    this.entries = items.map((item, index) => ({ item, index, start: start(item), end: end(item) })).sort((left, right) => left.start - right.start);
    const build = (low: number, high: number): IntervalNode<T> | null => {
      if (low >= high) return null;
      const middle = Math.floor((low + high) / 2);
      const left = build(low, middle);
      const right = build(middle + 1, high);
      const entry = this.entries[middle];
      return { entry, left, right, maxEnd: Math.max(entry.end, left?.maxEnd ?? -Infinity, right?.maxEnd ?? -Infinity) };
    };
    this.root = build(0, this.entries.length);
  }

  /** Every indexed item whose span overlaps `[start, end]`. */
  query(start: number, end: number): IndexedInterval<T>[] {
    const matches: IndexedInterval<T>[] = [];
    const visit = (node: IntervalNode<T> | null): void => {
      if (!node || node.maxEnd < start) return;
      visit(node.left);
      if (node.entry.start > end) return;
      if (node.entry.end >= start) matches.push(node.entry);
      visit(node.right);
    };
    visit(this.root);
    return matches;
  }

  /** Whether any indexed item overlaps `[start, end]`, short-circuiting on the first hit. */
  has(start: number, end: number): boolean {
    const visit = (node: IntervalNode<T> | null): boolean => {
      if (!node || node.maxEnd < start) return false;
      if (visit(node.left)) return true;
      if (node.entry.start > end) return false;
      return node.entry.end >= start || visit(node.right);
    };
    return visit(this.root);
  }
}
