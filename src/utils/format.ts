export function formatAmount(value: number, decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = Math.abs(safe).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return safe < 0 ? `(${formatted})` : formatted;
}

export function formatShillings(value: number, currency = 'TZS', decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = Math.abs(safe).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return safe < 0 ? `-${currency} ${formatted}` : `${currency} ${formatted}`;
}

export function formatSignedShillings(value: number, currency = 'TZS', decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = Math.abs(safe).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (safe > 0) return `+${currency} ${formatted}`;
  if (safe < 0) return `-${currency} ${formatted}`;
  return `${currency} ${formatted}`;
}

export function formatPricePerUnit(value: number, currency = 'TZS'): string {
  const safe = Number.isFinite(value) ? value : 0;
  const hasSubDecimals = Math.abs(safe % 1) > 0.001 && Math.abs((safe * 100) % 1) > 0.001;
  const decimals = hasSubDecimals ? 4 : 2;
  return `${currency} ${safe.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function firstDayOfMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ddMmYyyyStamp(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}${mm}${yyyy}`;
}
