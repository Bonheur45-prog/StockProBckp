import { useEffect, useMemo, useState } from "react";

/**
 * Client-side pagination for a locally-held array (our data is Dexie-backed
 * and usually small per store, so slicing in memory is simpler and fast
 * enough — no need for a second server round trip).
 */
export function usePagination(items, pageSize = 8) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  // Keep the page in range if the underlying data shrinks (e.g. a filter
  // changes) or grows past the current page.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [pageCount, page]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return { page, setPage, pageCount, pageItems, totalItems: items.length, pageSize };
}
