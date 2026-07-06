import { List, type RowComponentProps } from "react-window";
import type { ReactNode } from "react";

// A thin wrapper over react-window's `List`, so the windowing library stays an
// implementation detail behind one component. Used for the sidebar branch lists,
// which can run to thousands of rows on a monorepo — only the visible rows (plus
// a small overscan) are ever in the DOM.
//
// The list's height is `min(count * rowHeight, maxHeight)`, so a short list stays
// compact (matching the old plain-DOM behaviour) while a long one caps at
// `maxHeight` and scrolls internally. Rows must be a fixed `rowHeight`.

interface RowData<T> {
  items: T[];
  render: (item: T, index: number) => ReactNode;
}

// react-window passes `{ index, style, ariaAttributes }` plus our `rowProps`.
// The `style` positions the row absolutely and MUST be applied to the outer node.
function VirtualRow<T>({ index, style, ariaAttributes, items, render }: RowComponentProps<RowData<T>>) {
  return (
    <div style={style} {...ariaAttributes}>
      {render(items[index], index)}
    </div>
  );
}

export function VirtualList<T>({
  items,
  rowHeight,
  maxHeight,
  render,
  overscanCount = 8,
  ariaLabel,
}: {
  items: T[];
  /** Fixed pixel height of every row. */
  rowHeight: number;
  /** Cap on the list's height; beyond this it scrolls internally. */
  maxHeight: number;
  render: (item: T, index: number) => ReactNode;
  overscanCount?: number;
  ariaLabel?: string;
}) {
  const height = Math.min(items.length * rowHeight, maxHeight);
  return (
    <List
      aria-label={ariaLabel}
      style={{ height, overflowX: "hidden" }}
      rowCount={items.length}
      rowHeight={rowHeight}
      overscanCount={overscanCount}
      rowComponent={VirtualRow<T>}
      rowProps={{ items, render }}
    />
  );
}
