import { useEffect, useState, type ReactNode } from "react";

export default function PagedList<T>({ items, renderItem, label = "名單分頁" }: { items: T[]; renderItem: (item: T) => ReactNode; label?: string }) {
  const [page, setPage] = useState(0);
  const size = 12;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [items]);
  return <>
    <div className="list-scroll paged-records">{items.slice(current * size, (current + 1) * size).map(renderItem)}{!items.length ? <p>找不到符合條件的資料。</p> : null}</div>
    <div className="record-pagination" aria-label={label}>
      <button type="button" className="ghost" disabled={current === 0} onClick={() => setPage(current - 1)}>上一頁</button>
      <span role="status">{items.length} 筆・{current + 1}/{pages} 頁</span>
      <button type="button" className="ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>下一頁</button>
    </div>
  </>;
}
