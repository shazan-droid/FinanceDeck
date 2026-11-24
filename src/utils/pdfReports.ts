import jsPDF from 'jspdf';
import autoTableImport, { applyPlugin as applyPluginImport } from 'jspdf-autotable/es';
import type { UserOptions } from 'jspdf-autotable';
import type { FinanceState, TransactionEntry } from '../types';
import { ddMmYyyyStamp, formatAmount, formatShillings, todayIso } from './format';

type AutoTableFn = (doc: jsPDF, opts: UserOptions) => void;

function runAutoTable(doc: jsPDF, options: UserOptions): void {
  const mod = autoTableImport as unknown as
    | AutoTableFn
    | { default?: AutoTableFn | { default?: AutoTableFn } };

  let directFn: AutoTableFn | null = null;
  if (typeof mod === 'function') {
    directFn = mod;
  } else if (mod && typeof mod === 'object') {
    if (typeof mod.default === 'function') {
      directFn = mod.default;
    } else if (mod.default && typeof mod.default === 'object' && typeof mod.default.default === 'function') {
      directFn = mod.default.default;
    }
  }

  if (directFn) {
    directFn(doc, options);
    return;
  }

  const docWithPlugin = doc as jsPDF & { autoTable?: (opts: UserOptions) => void };
  if (typeof docWithPlugin.autoTable === 'function') {
    docWithPlugin.autoTable(options);
    return;
  }

  const applyFn = applyPluginImport as unknown;
  if (typeof applyFn === 'function') {
    (applyFn as (jsPdfClass: typeof jsPDF) => void)(jsPDF);
    const attached = (doc as unknown as { autoTable?: (opts: UserOptions) => void }).autoTable;
    if (typeof attached === 'function') {
      attached.call(doc, options);
      return;
    }
  }

  throw new Error('PDF table generator could not be initialized.');
}

export type ReportKey =
  | 'balance_sheet'
  | 'income_statement'
  | 'cash_flow'
  | 'equity'
  | 'notes'
  | 'portfolio';

export interface GeneratedPdfResult {
  filename: string;
  blobUrl: string;
  title: string;
  pageCount: number;
}

export interface ExpenseSlice {
  category: string;
  amount: number;
  pct: number;
  color: string;
}

export const EXPENSE_PIE_COLORS = [
  '#C1121F',
  '#2563EB',
  '#D97706',
  '#059669',
  '#7C3AED',
  '#0891B2',
  '#DB2777',
  '#6B7280',
];

export const REPORT_DEFINITIONS: Array<{
  key: ReportKey;
  title: string;
  description: string;
}> = [
  {
    key: 'balance_sheet',
    title: 'Balance Sheet',
    description: 'Assets, liabilities & net worth as at end date',
  },
  {
    key: 'income_statement',
    title: 'Income Statement & Expense Pie',
    description: 'Operating inflows, expenses & pie chart for period',
  },
  {
    key: 'cash_flow',
    title: 'Cash Flow Statement',
    description: 'Operating, investing & financing cash movements',
  },
  {
    key: 'equity',
    title: 'Statement of Equity',
    description: 'Period equity bridge, net worth & progress vs target',
  },
  {
    key: 'notes',
    title: 'Financial Notes',
    description: 'Period burn, working capital, runway & benchmarks',
  },
  {
    key: 'portfolio',
    title: 'Investment Portfolio',
    description: 'DSE stocks, ETFs, bonds & UTT AMIS holdings as at end date',
  },
];

export function computeExpenseBreakdown(
  transactions: TransactionEntry[],
  fromDate: string,
  toDate: string,
  operatingOnly = false
): { slices: ExpenseSlice[]; totalExpenses: number } {
  const map = new Map<string, number>();
  let total = 0;

  for (const t of transactions) {
    if (operatingOnly && t.activity !== 'operating') continue;
    if (fromDate && t.date < fromDate) continue;
    if (toDate && t.date > toDate) continue;
    const amt = Number(t.amount) || 0;
    if (amt < 0) {
      const abs = Math.abs(amt);
      const cat = (t.category || 'Other').trim() || 'Other';
      map.set(cat, (map.get(cat) || 0) + abs);
      total += abs;
    }
  }

  if (total <= 0) {
    return { slices: [], totalExpenses: 0 };
  }

  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  const primary = sorted.slice(0, 7);
  const rest = sorted.slice(7);
  if (rest.length > 0) {
    const otherSum = rest.reduce((acc, [, v]) => acc + v, 0);
    const existingOther = primary.find(([k]) => k === 'Other');
    if (existingOther) {
      existingOther[1] += otherSum;
    } else {
      primary.push(['Other', otherSum]);
    }
  }

  const slices: ExpenseSlice[] = primary.map(([category, amount], idx) => ({
    category,
    amount,
    pct: (amount / total) * 100,
    color: EXPENSE_PIE_COLORS[idx % EXPENSE_PIE_COLORS.length],
  }));

  return { slices, totalExpenses: total };
}

function renderExpensePieChartDataUrl(
  slices: ExpenseSlice[],
  totalExpenses: number,
  title: string
): string | null {
  if (typeof document === 'undefined' || slices.length === 0 || !Number.isFinite(totalExpenses) || totalExpenses <= 0) {
    return null;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1040;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Clean light report panel background for crisp printability
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    // Header
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(title, 32, 42);

    ctx.fillStyle = '#6B7280';
    ctx.font = '18px sans-serif';
    ctx.fillText(`Total Outflows: ${formatShillings(totalExpenses, 'TZS', 0)}`, 32, 70);

    // Pie / Donut geometry
    const cx = 205;
    const cy = 242;
    const radius = 130;
    let startAngle = -Math.PI / 2;

    for (const s of slices) {
      const sweep = (s.amount / totalExpenses) * Math.PI * 2;
      if (!Number.isFinite(sweep) || sweep <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, startAngle + sweep);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 3;
      ctx.stroke();
      startAngle += sweep;
    }

    // Donut inner cutout for crisp editorial look
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.fillStyle = '#FAFAFA';
    ctx.fill();

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${slices.length} Categories`, cx, cy + 5);
    ctx.textAlign = 'left';

    // Legend on the right
    let ly = 112;
    const lx = 395;
    for (const s of slices) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, ly - 14, 16, 16);

      ctx.fillStyle = '#111827';
      ctx.font = 'bold 18px sans-serif';
      const label = s.category.length > 22 ? `${s.category.slice(0, 20)}...` : s.category;
      ctx.fillText(label, lx + 28, ly);

      ctx.fillStyle = '#374151';
      ctx.font = '17px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(
        `${s.pct.toFixed(1)}%  ·  ${formatShillings(s.amount, 'TZS', 0)}`,
        canvas.width - 32,
        ly
      );
      ctx.textAlign = 'left';
      ly += 38;
    }

    const url = canvas.toDataURL('image/png');
    return url && url.startsWith('data:image/png') ? url : null;
  } catch {
    return null;
  }
}

function addHeaderBanner(doc: jsPDF, title: string, subtitle: string): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(18, 18, 18);
  doc.rect(0, 0, pageWidth, 68, 'F');
  doc.setFillColor(193, 18, 31);
  doc.rect(0, 68, pageWidth, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text(`FINANCEDESK · ${title}`, 40, 32);

  doc.setTextColor(190, 190, 190);
  doc.setFontSize(9.5);
  doc.text(subtitle, 40, 50);
}

function createDoc(title: string, subtitle: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  addHeaderBanner(doc, title, subtitle);
  return doc;
}

export function triggerBlobDownload(blob: Blob, filename: string): string {
  const blobUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    window.setTimeout(() => {
      try {
        a.remove();
      } catch {
        // Ignore DOM cleanup error
      }
    }, 1500);
  } catch {
    // Fallback link via returned blobUrl remains available in the UI
  }
  return blobUrl;
}

function finalizePdfExport(doc: jsPDF, filename: string, title: string): GeneratedPdfResult {
  const pageCount = doc.getNumberOfPages();
  const blob = doc.output('blob');
  const blobUrl = triggerBlobDownload(blob, filename);
  return { filename, blobUrl, title, pageCount };
}

function getLastTableY(doc: jsPDF, fallback = 320): number {
  return (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? fallback;
}

function appendExpensePieToDoc(
  doc: jsPDF,
  transactions: TransactionEntry[],
  fromDate: string,
  toDate: string,
  title: string,
  operatingOnly: boolean
): void {
  const { slices, totalExpenses } = computeExpenseBreakdown(
    transactions,
    fromDate,
    toDate,
    operatingOnly
  );
  const imgData = renderExpensePieChartDataUrl(slices, totalExpenses, title);
  let y = getLastTableY(doc, 240) + 22;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const imgW = pageWidth - 80;
  const imgH = Math.round((imgW * 420) / 1040);

  if (!imgData) {
    if (y + 30 > pageHeight - 40) {
      doc.addPage();
      y = 48;
    }
    doc.setFontSize(9.5);
    doc.setTextColor(110, 110, 110);
    doc.text('No expenses recorded during the selected period for pie chart breakdown.', 40, y);
    return;
  }

  if (y + imgH > pageHeight - 36) {
    doc.addPage();
    y = 48;
  }
  doc.addImage(imgData, 'PNG', 40, y, imgW, imgH);
}

function computeScopedMetrics(
  state: FinanceState,
  safeFrom: string,
  safeTo: string
) {
  const allBalance = Array.isArray(state.balance) ? state.balance : [];
  const allTransactions = Array.isArray(state.transactions) ? state.transactions : [];
  const allHoldings = Array.isArray(state.holdings) ? state.holdings : [];

  const balance = safeTo
    ? allBalance.filter((b) => !b.date || b.date <= safeTo)
    : allBalance;
  const holdings = safeTo
    ? allHoldings.filter((h) => !h.date || h.date <= safeTo)
    : allHoldings;
  const periodTx = allTransactions.filter((t) => {
    const d = t.date || '';
    return (!safeFrom || d >= safeFrom) && (!safeTo || d <= safeTo);
  });

  let ca = 0;
  let cl = 0;
  let la = 0;
  let ll = 0;
  let bank = 0;
  let hand = 0;
  for (const r of balance) {
    const val = Number(r.amount) || 0;
    if (r.section === 'current_asset') ca += val;
    else if (r.section === 'current_liability') cl += val;
    else if (r.section === 'longterm_asset') la += val;
    else if (r.section === 'longterm_liability') ll += val;

    if (r.type === 'Cash in bank') bank += val;
    else if (r.type === 'Cash in hand') hand += val;
  }

  let port = 0;
  let stocks = 0;
  let bf = 0;
  for (const h of holdings) {
    const units = Number(h.units) || 0;
    if (units <= 0) continue;
    const cost = Number(h.cost) || 0;
    const price = Number(h.price) || 0;
    const val = units * (price > 0 ? price : cost);
    port += val;
    if (h.kind === 'DSE Stock' || h.kind === 'Stock' || h.kind === 'ETF') {
      stocks += val;
    } else if (h.kind === 'Bond' || h.kind === 'Fund') {
      bf += val;
    }
  }
  la += port;

  let opInflows = 0;
  let opOutflows = 0;
  let invNet = 0;
  let finNet = 0;
  for (const t of periodTx) {
    const amt = Number(t.amount) || 0;
    if (t.activity === 'operating') {
      if (amt >= 0) opInflows += amt;
      else opOutflows += Math.abs(amt);
    } else if (t.activity === 'investing') {
      invNet += amt;
    } else if (t.activity === 'financing') {
      finNet += amt;
    }
  }

  const snapshot = {
    ca,
    cl,
    la,
    ll,
    port,
    wc: ca - cl,
    nw: ca + la - cl - ll,
    bank,
    hand,
    stocks,
    bf,
  };

  return {
    balance,
    holdings,
    allTransactions,
    periodTx,
    snapshot,
    opInflows,
    opOutflows,
    opNet: opInflows - opOutflows,
    invNet,
    finNet,
    netCashChange: opInflows - opOutflows + invNet + finNet,
  };
}

function renderReportIntoDoc(
  doc: jsPDF,
  key: ReportKey,
  state: FinanceState,
  fromDate: string,
  toDate: string
): void {
  const currency = 'TZS';
  const safeFrom = fromDate || '';
  const safeTo = toDate || '';
  const asAtDate = safeTo || todayIso();
  const periodLabel = safeFrom || safeTo ? `${safeFrom || 'Start'} to ${safeTo || 'Today'}` : 'All Dates';

  const indicators = Array.isArray(state.indicators) ? state.indicators : [];
  const settings = state.settings ?? { target: 0, autoRefreshOnOpen: true };
  const runway = state.runway ?? { months: null, burn: 0 };

  const scoped = computeScopedMetrics(state, safeFrom, safeTo);
  const { balance, holdings, allTransactions, periodTx, snapshot } = scoped;

  if (key === 'balance_sheet') {
    addHeaderBanner(
      doc,
      'Balance Sheet',
      `As at ${asAtDate} · Selected Period: ${periodLabel} · Currency: ${currency}`
    );
    const rows = [
      ...balance
        .filter((b) => b.section === 'current_asset')
        .map((b) => ['Current Asset', b.type || '-', b.name || '-', formatAmount(Number(b.amount) || 0)]),
      ['Current Asset', 'Subtotal', 'Total Current Assets', formatAmount(snapshot.ca)],
      ...balance
        .filter((b) => b.section === 'longterm_asset')
        .map((b) => ['Long-Term Asset', b.type || '-', b.name || '-', formatAmount(Number(b.amount) || 0)]),
      ['Long-Term Asset', 'Portfolio', 'Investments Market Value', formatAmount(snapshot.port)],
      ['Long-Term Asset', 'Subtotal', 'Total Long-Term Assets', formatAmount(snapshot.la)],
      ...balance
        .filter((b) => b.section === 'current_liability')
        .map((b) => ['Current Liability', b.type || '-', b.name || '-', formatAmount(Number(b.amount) || 0)]),
      ['Current Liability', 'Subtotal', 'Total Current Liabilities', formatAmount(snapshot.cl)],
      ...balance
        .filter((b) => b.section === 'longterm_liability')
        .map((b) => ['Long-Term Liability', b.type || '-', b.name || '-', formatAmount(Number(b.amount) || 0)]),
      ['Long-Term Liability', 'Subtotal', 'Total Long-Term Liabilities', formatAmount(snapshot.ll)],
      ['Equity', 'Net Worth', `Total Assets Minus Liabilities (${asAtDate})`, formatAmount(snapshot.nw)],
    ];
    runAutoTable(doc, {
      startY: 88,
      head: [['Section', 'Type', 'Description', `Amount (${currency})`]],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [193, 18, 31] },
      columnStyles: { 3: { halign: 'right' } },
    });
    return;
  }

  if (key === 'income_statement') {
    addHeaderBanner(
      doc,
      'Income Statement & Expenses',
      `Period: ${periodLabel} · Currency: ${currency}`
    );
    const ops = periodTx.filter((t) => t.activity === 'operating');
    const incomeMap = new Map<string, number>();
    const expMap = new Map<string, number>();
    let totalInc = 0;
    let totalExp = 0;
    for (const t of ops) {
      const amt = Number(t.amount) || 0;
      const cat = t.category || 'Other';
      if (amt >= 0) {
        totalInc += amt;
        incomeMap.set(cat, (incomeMap.get(cat) || 0) + amt);
      } else {
        const abs = Math.abs(amt);
        totalExp += abs;
        expMap.set(cat, (expMap.get(cat) || 0) + abs);
      }
    }
    const rows = [
      ...[...incomeMap.entries()].map(([cat, amt]) => ['Income', cat, formatAmount(amt)]),
      ['Subtotal', 'Total Operating Income', formatAmount(totalInc)],
      ...[...expMap.entries()].map(([cat, amt]) => ['Expense', cat, formatAmount(-amt)]),
      ['Subtotal', 'Total Operating Expenses', formatAmount(-totalExp)],
      ['Summary', 'Net Operating Income', formatAmount(totalInc - totalExp)],
    ];
    runAutoTable(doc, {
      startY: 88,
      head: [['Class', 'Category', `Amount (${currency})`]],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [193, 18, 31] },
      columnStyles: { 2: { halign: 'right' } },
    });
    appendExpensePieToDoc(
      doc,
      allTransactions,
      safeFrom,
      safeTo,
      `Operating Expenses Breakdown (${periodLabel})`,
      true
    );
    return;
  }

  if (key === 'cash_flow') {
    addHeaderBanner(
      doc,
      'Cash Flow Statement',
      `Period: ${periodLabel} · Currency: ${currency}`
    );
    const rows = [
      ...periodTx.map((t) => [
        t.date || '-',
        t.activity || '-',
        t.category || '-',
        t.description || '-',
        t.receiptName ? 'Attached' : '-',
        formatAmount(Number(t.amount) || 0),
      ]),
      ['', 'Summary', 'Net Operating Cash Flow', '', '', formatAmount(scoped.opNet)],
      ['', 'Summary', 'Net Investing Cash Flow', '', '', formatAmount(scoped.invNet)],
      ['', 'Summary', 'Net Financing Cash Flow', '', '', formatAmount(scoped.finNet)],
      ['', 'Total', 'Net Change in Cash', '', '', formatAmount(scoped.netCashChange)],
    ];
    runAutoTable(doc, {
      startY: 88,
      head: [['Date', 'Activity', 'Category', 'Description', 'Receipt', `Amount (${currency})`]],
      body: rows,
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [193, 18, 31] },
      columnStyles: { 5: { halign: 'right' } },
    });
    appendExpensePieToDoc(
      doc,
      allTransactions,
      safeFrom,
      safeTo,
      `Total Outflows by Category (${periodLabel})`,
      false
    );
    return;
  }

  if (key === 'equity') {
    addHeaderBanner(
      doc,
      'Statement of Equity',
      `As at ${asAtDate} · Period: ${periodLabel} · Currency: ${currency}`
    );
    const nw = Number(snapshot.nw) || 0;
    const tgt = Number(settings.target) || 0;
    const pct = tgt > 0 ? ((nw / tgt) * 100).toFixed(2) : '0.00';
    runAutoTable(doc, {
      startY: 88,
      head: [['Metric', `Value (${currency})`]],
      body: [
        ['Cash in Bank', formatShillings(snapshot.bank, currency)],
        ['Cash in Hand', formatShillings(snapshot.hand, currency)],
        ['Stocks & ETFs', formatShillings(snapshot.stocks, currency)],
        ['Bonds & Funds', formatShillings(snapshot.bf, currency)],
        ['Total Assets', formatShillings(snapshot.ca + snapshot.la, currency)],
        ['Total Liabilities', formatShillings(snapshot.cl + snapshot.ll, currency)],
        [`Net Worth (as at ${asAtDate})`, formatShillings(nw, currency)],
        [`Period Operating Net Income (${periodLabel})`, formatShillings(scoped.opNet, currency)],
        [`Period Investing Cash Flow (${periodLabel})`, formatShillings(scoped.invNet, currency)],
        [`Period Financing Cash Flow (${periodLabel})`, formatShillings(scoped.finNet, currency)],
        [`Period Net Cash Change (${periodLabel})`, formatShillings(scoped.netCashChange, currency)],
        ['Target Net Worth', formatShillings(tgt, currency)],
        ['Target Achievement', `${pct}%`],
      ],
      styles: { fontSize: 9.5 },
      headStyles: { fillColor: [193, 18, 31] },
      columnStyles: { 1: { halign: 'right' } },
    });
    return;
  }

  if (key === 'notes') {
    addHeaderBanner(
      doc,
      'Financial Notes',
      `As at ${asAtDate} · Period: ${periodLabel} · Currency: ${currency}`
    );
    const currentRatio = snapshot.cl > 0 ? (snapshot.ca / snapshot.cl).toFixed(2) : 'n/a';
    const runwayText =
      typeof runway.months === 'number' && Number.isFinite(runway.months)
        ? `${runway.months.toFixed(1)} months`
        : 'n/a';
    runAutoTable(doc, {
      startY: 88,
      head: [['Note / Benchmark', 'Value / Status']],
      body: [
        ['Selected Report Period', periodLabel],
        ['Period Transactions Count', `${periodTx.length}`],
        ['Period Operating Inflows', formatShillings(scoped.opInflows, currency)],
        ['Period Operating Expenses', formatShillings(scoped.opOutflows, currency)],
        ['Period Net Cash Flow', formatShillings(scoped.netCashChange, currency)],
        [`Working Capital (as at ${asAtDate})`, formatShillings(snapshot.wc, currency)],
        ['Current Ratio', currentRatio],
        ['90-Day Avg Monthly Operating Burn', formatShillings(Number(runway.burn) || 0, currency)],
        ['Estimated Cash Runway', runwayText],
        ...indicators.map((i) => [i.name || '-', `${i.value || '-'} (${i.updated || 'unfetched'})`]),
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [193, 18, 31] },
    });
    return;
  }

  addHeaderBanner(
    doc,
    'Investment Portfolio',
    `As at ${asAtDate} · Currency: ${currency}`
  );
  let totalCost = 0;
  let totalVal = 0;
  const rows = holdings.map((h) => {
    const units = Number(h.units) || 0;
    const cost = Number(h.cost) || 0;
    const price = Number(h.price) || 0;
    const px = price > 0 ? price : cost;
    const val = units * px;
    const basis = units * cost;
    totalCost += basis;
    totalVal += val;
    return [
      h.symbol || '-',
      h.kind || '-',
      units.toLocaleString('en-US', { maximumFractionDigits: 4 }),
      formatAmount(cost),
      formatAmount(price),
      formatAmount(val),
      formatAmount(val - basis),
      h.source || '-',
    ];
  });
  rows.push([
    'TOTAL',
    '',
    '',
    formatAmount(totalCost),
    '',
    formatAmount(totalVal),
    formatAmount(totalVal - totalCost),
    '',
  ]);
  runAutoTable(doc, {
    startY: 88,
    head: [['Ticker / Name', 'Type', 'Units', 'Cost', 'Price', 'Value', 'P/L', 'Source']],
    body: rows,
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [193, 18, 31] },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
  });
}

export function generatePdfReport(
  key: ReportKey,
  state: FinanceState,
  fromDate: string,
  toDate: string
): GeneratedPdfResult {
  const stamp = ddMmYyyyStamp();
  const filename = `${stamp}_${key}.pdf`;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  renderReportIntoDoc(doc, key, state, fromDate, toDate);
  const title = REPORT_DEFINITIONS.find((r) => r.key === key)?.title || 'Financial Report';
  return finalizePdfExport(doc, filename, title);
}

export function generateCombinedPdfPack(
  state: FinanceState,
  fromDate: string,
  toDate: string
): GeneratedPdfResult {
  const stamp = ddMmYyyyStamp();
  const filename = `${stamp}_financial_pack.pdf`;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  REPORT_DEFINITIONS.forEach((def, idx) => {
    if (idx > 0) doc.addPage();
    renderReportIntoDoc(doc, def.key, state, fromDate, toDate);
  });

  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(130, 130, 130);
    doc.text(
      `FinanceDesk Complete Financial Statements Pack · Page ${p} of ${totalPages}`,
      pageWidth - 40,
      pageHeight - 18,
      { align: 'right' }
    );
  }

  return finalizePdfExport(doc, filename, 'Complete Financial Statements Pack');
}

export function generateKhumsTaxPdf(params: {
  includeKhums?: boolean;
  khumsYearDate: string;
  khumsItems: Array<{ label: string; amount: number; sign: '+' | '-' | '=' }>;
  totalKhums: number;
  sahmAlImam: number;
  sahmAlSadat: number;
  retainedAfterKhums: number;
  traRows: Array<{ label: string; basis: string; rate: string; tax: number }>;
  totalAnnualTax: number;
  totalNetAfterTax: number;
  effectiveRatePct: number;
}): GeneratedPdfResult {
  const includeKhums = params.includeKhums !== false;
  const currency = 'TZS';
  const stamp = ddMmYyyyStamp();
  const filename = includeKhums
    ? `${stamp}_khums_tax_summary.pdf`
    : `${stamp}_tra_tax_summary.pdf`;
  const title = includeKhums
    ? 'Khums (Al-Sistani) & Tanzania TRA Tax Summary'
    : 'Tanzania TRA Tax Summary';
  const subtitle = includeKhums
    ? `Khums Year Date: ${params.khumsYearDate} · Generated ${todayIso()} · Currency: ${currency}`
    : `TRA Jurisdiction · Generated ${todayIso()} · Currency: ${currency}`;

  const doc = createDoc(title, subtitle);

  let traStartY = 88;
  if (includeKhums) {
    runAutoTable(doc, {
      startY: 88,
      head: [['Khums Assessment (Ayatollah al-Sistani)', 'Effect', `Amount (${currency})`]],
      body: [
        ...params.khumsItems.map((it) => [
          it.label,
          it.sign === '+' ? 'Add' : it.sign === '-' ? 'Deduct' : 'Result',
          formatAmount(it.amount),
        ]),
        ['Total Khums Due (20%)', 'Payable', formatAmount(params.totalKhums)],
        ['Sahm al-Imam (50% of Khums / 10%)', 'Share 1', formatAmount(params.sahmAlImam)],
        ['Sahm al-Sadat (50% of Khums / 10%)', 'Share 2', formatAmount(params.sahmAlSadat)],
        ['Halal Remainder Kept (80%)', 'Retained', formatAmount(params.retainedAfterKhums)],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [193, 18, 31] },
      columnStyles: { 2: { halign: 'right' } },
    });
    traStartY = getLastTableY(doc, 320) + 20;
  }

  runAutoTable(doc, {
    startY: traStartY,
    head: [['Tanzania TRA Tax Component', 'Taxable Base (TZS)', 'Rate', `Annual Tax (${currency})`]],
    body: [
      ...params.traRows.map((r) => [r.label, r.basis, r.rate, formatAmount(r.tax)]),
      [
        'Total Annual Tanzania Tax Liability',
        '',
        `${params.effectiveRatePct.toFixed(2)}% eff.`,
        formatAmount(params.totalAnnualTax),
      ],
      ['Annual Net Income After Tax & NSSF', '', '', formatAmount(params.totalNetAfterTax)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 30, 30] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  return finalizePdfExport(
    doc,
    filename,
    includeKhums ? 'Khums & TRA Tax Summary' : 'Tanzania TRA Tax Summary'
  );
}
