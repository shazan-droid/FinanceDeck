export interface KpiItem {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'default' | 'positive' | 'negative';
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {items.map((item) => {
        const valueColor =
          item.tone === 'positive'
            ? 'text-emerald-400'
            : item.tone === 'negative'
              ? 'text-red-400'
              : 'text-white';

        return (
          <div
            key={item.label}
            className="min-w-0 rounded-lg border border-[#242424] bg-[#121212] px-3.5 py-3 sm:px-5 sm:py-4"
          >
            <p className="truncate text-[11px] font-medium text-[#8A8A8A] sm:text-xs">{item.label}</p>
            <p
              className={`font-mono-nums mt-1 break-words text-[15px] leading-snug font-semibold tracking-tight sm:mt-1.5 sm:text-xl ${valueColor}`}
            >
              {item.value}
            </p>
            {item.sublabel && (
              <p className="mt-1 line-clamp-2 text-[11px] text-[#737373] sm:text-xs">{item.sublabel}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
