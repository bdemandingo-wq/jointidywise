import { useEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

export function VirtualMediaGrid<T extends { id: string }>({ items, renderItem }: {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ width: 0, top: 0, columns: 2 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      const width = window.innerWidth;
      setLayout({ width: rect.width, top: rect.top + window.scrollY, columns: width >= 1024 ? 5 : width >= 768 ? 4 : width >= 640 ? 3 : 2 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const rowHeight = (layout.width - (layout.columns - 1) * 8) / layout.columns + 84;
  const virtual = useWindowVirtualizer({ count: Math.ceil(items.length / layout.columns), estimateSize: () => rowHeight,
    scrollMargin: layout.top, overscan: 2 });
  useEffect(() => { virtual.measure(); }, [virtual, rowHeight]);
  return <div ref={ref} style={{ height: virtual.getTotalSize() }} className="relative w-full" aria-label="Booking media gallery">
    {virtual.getVirtualItems().map(row => <div key={row.key} className="absolute left-0 top-0 grid w-full gap-2"
      style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, transform: `translateY(${row.start - layout.top}px)`, height: rowHeight - 8 }}>
      {items.slice(row.index * layout.columns, (row.index + 1) * layout.columns).map(item => <div key={item.id} className="min-w-0">{renderItem(item)}</div>)}
    </div>)}
  </div>;
}