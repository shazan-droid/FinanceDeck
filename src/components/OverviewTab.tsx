import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  FileDown,
  FileSpreadsheet,
  Lock,
  Printer,
  Sparkles,
  X,
} from 'lucide-react';
import type { AppLanguage, FinanceState, MonthlyFixedExpense } from '../types';
import { getTranslations } from '../utils/i18n';
import {
  exportBalanceSheetCsv,
  exportCashFlowCsv,
  exportHoldingsCsv,
  type GeneratedCsvResult,
} from '../utils/csvExports';
import { firstDayOfMonthIso, formatShillings, todayIso } from '../utils/format';
import {
  computeExpenseBreakdown,
  generateCombinedPdfPack,
  generatePdfReport,
  REPORT_DEFINITIONS,
  type GeneratedPdfResult,
  type ReportKey,
} from '../utils/pdfReports';
import { KpiStrip } from './KpiStrip';

interface OverviewTabProps {
  state: FinanceState;
  language: AppLanguage;
  fromDate: string;
  toDate: string;
  onFromDateChange: (val: string) => void;
  onToDateChange: (val: string) => void;
  onSaveSettings: (patch: {
    language?: AppLanguage;
    target?: number;
    autoRefreshOnOpen?: boolean;
    onboardingCompleted?: boolean;
    khumsEnabled?: boolean;
    monthlyFixedExpenses?: MonthlyFixedExpense[];
  }) => Promise<void>;
  onNavigateTab: (tab: 'working-capital' | 'long-term' | 'investments') => void;
  onOpenStatementImport: () => void;
  onOpenSetup: () => void;
  onRequirePro: (feature: 'ai_import' | 'reports') => void;
  onAuthorizeReport: () => Promise<boolean>;
}

export function OverviewTab({
  state,
  language,
  fromDate,
  toDate,
  onFromDateChange,
  onToDateChange,
  onSaveSettings,
  onNavigateTab,
  onOpenStatementImport,
  onOpenSetup,
  onRequirePro,
  onAuthorizeReport,
}: OverviewTabProps) {
  const { settings, snapshot, transactions } = state;
  const currency = 'TZS';
  const t = getTranslations(language);
  const isPro = settings.plan === 'pro';

  const [targetInput, setTargetInput] = useState(String(settings.target));
  const [reportNotice, setReportNotice] = useState<string>('');
  const [reportError, setReportError] = useState<string>('');
  const [lastDownload, setLastDownload] = useState<{
    filename: string;
    blobUrl: string;
    title: string;
    isPdf: boolean;
    pageCount?: number;
    csvText?: string;
    rowCount?: number;
  } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copiedCsv, setCopiedCsv] = useState(false);
  const prevUrlRef = useRef<string | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setTargetInput(String(settings.target));
  }, [settings.target]);

  useEffect(() => {
    return () => {
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
      }
    };
  }, []);

  const registerExportResult = (
    res:
      | (GeneratedPdfResult & { csvText?: undefined; rowCount?: undefined })
      | (GeneratedCsvResult & { pageCount?: undefined }),
    isPdf: boolean,
    openPreview: boolean
  ) => {
    if (prevUrlRef.current && prevUrlRef.current !== res.blobUrl) {
      URL.revokeObjectURL(prevUrlRef.current);
    }
    prevUrlRef.current = res.blobUrl;
    setCopiedCsv(false);
    setLastDownload({
      filename: res.filename,
      blobUrl: res.blobUrl,
      title: res.title,
      isPdf,
      pageCount: res.pageCount,
      csvText: res.csvText,
      rowCount: res.rowCount,
    });
    const detail = isPdf
      ? res.pageCount
        ? ` (${res.pageCount} ${res.pageCount === 1 ? 'page' : 'pages'})`
        : ''
      : typeof res.rowCount === 'number'
        ? ` (${res.rowCount} ${res.rowCount === 1 ? 'row' : 'rows'})`
        : '';
    setReportNotice(`Prepared ${res.filename}${detail}`);
    setReportError('');
    if (openPreview) {
      setPreviewOpen(true);
    }
  };

  const periodLabel = useMemo(
    () => (fromDate || toDate ? `${fromDate || 'Start'} to ${toDate || 'Today'}` : 'All Dates'),
    [fromDate, toDate]
  );

  const periodCashFlow = useMemo(
    () =>
      transactions
        .filter((t) => (!fromDate || t.date >= fromDate) && (!toDate || t.date <= toDate))
        .reduce((acc, t) => acc + t.amount, 0),
    [transactions, fromDate, toDate]
  );

  const applyDatePreset = (preset: 'this_month' | 'last_month' | 'last_90' | 'ytd' | 'all') => {
    const now = new Date();
    const fmt = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (preset === 'this_month') {
      onFromDateChange(firstDayOfMonthIso());
      onToDateChange(todayIso());
    } else if (preset === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      onFromDateChange(fmt(start));
      onToDateChange(fmt(end));
    } else if (preset === 'last_90') {
      const start = new Date(now.getTime() - 89 * 86400000);
      onFromDateChange(fmt(start));
      onToDateChange(todayIso());
    } else if (preset === 'ytd') {
      onFromDateChange(`${now.getFullYear()}-01-01`);
      onToDateChange(todayIso());
    } else {
      onFromDateChange('');
      onToDateChange('');
    }
  };

  const expenseBreakdown = useMemo(
    () => computeExpenseBreakdown(transactions, fromDate, toDate, false),
    [transactions, fromDate, toDate]
  );

  const expensePieSegments = useMemo(() => {
    const { slices, totalExpenses } = expenseBreakdown;
    if (slices.length === 0 || totalExpenses <= 0) return [];
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return slices.map((s) => {
      const length = (s.amount / totalExpenses) * circumference;
      const seg = {
        ...s,
        dashArray: `${length} ${circumference - length}`,
        dashOffset: -offset,
      };
      offset += length;
      return seg;
    });
  }, [expenseBreakdown]);

  const target = settings.target > 0 ? settings.target : 1;
  const targetProgressItems = useMemo(() => {
    const items = [
      { label: 'Net worth', value: snapshot.nw, accent: true },
      { label: 'Cash in bank', value: snapshot.bank, accent: false },
      { label: 'Cash in hand', value: snapshot.hand, accent: false },
      { label: 'Stocks & ETFs', value: snapshot.stocks, accent: false },
      { label: 'Bonds & funds', value: snapshot.bf, accent: false },
    ];
    return items.map((it) => ({
      ...it,
      pct: (it.value / target) * 100,
    }));
  }, [snapshot, target]);

  const maxTargetPct = useMemo(() => {
    const highest = Math.max(100, ...targetProgressItems.map((i) => i.pct));
    return Math.ceil(highest / 10) * 10;
  }, [targetProgressItems]);

  const monthlySeries = useMemo(() => {
    const buckets = new Map<string, { month: string; income: number; expenses: number }>();
    for (const t of transactions) {
      if (t.activity !== 'operating') continue;
      const month = t.date.slice(0, 7);
      if (!month) continue;
      const cur = buckets.get(month) ?? { month, income: 0, expenses: 0 };
      const val = t.amount;
      if (val > 0) cur.income += val;
      else if (val < 0) cur.expenses += Math.abs(val);
      buckets.set(month, cur);
    }
    return [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [transactions]);

  const maxMonthlyVal = useMemo(() => {
    const peak = Math.max(1, ...monthlySeries.flatMap((m) => [m.income, m.expenses]));
    return peak;
  }, [monthlySeries]);

  const handleGenerateSingle = async (key: ReportKey) => {
    if (!isPro) {
      onRequirePro('reports');
      return;
    }
    try {
      const ok = await onAuthorizeReport();
      if (!ok) {
        onRequirePro('reports');
        return;
      }
      const res: GeneratedPdfResult = generatePdfReport(key, state, fromDate, toDate);
      registerExportResult(res, true, true);
    } catch (e) {
      setReportError(`Export failed: ${(e as Error).message}`);
    }
  };

  const handleGenerateAll = async () => {
    if (!isPro) {
      onRequirePro('reports');
      return;
    }
    try {
      const ok = await onAuthorizeReport();
      if (!ok) {
        onRequirePro('reports');
        return;
      }
      const res: GeneratedPdfResult = generateCombinedPdfPack(state, fromDate, toDate);
      registerExportResult(res, true, true);
    } catch (e) {
      setReportError(`Export failed: ${(e as Error).message}`);
    }
  };

  const handleCsvExport = async (type: 'cashflow' | 'holdings' | 'balance') => {
    if (!isPro) {
      onRequirePro('reports');
      return;
    }
    try {
      const ok = await onAuthorizeReport();
      if (!ok) {
        onRequirePro('reports');
        return;
      }
      const res: GeneratedCsvResult =
        type === 'cashflow'
          ? exportCashFlowCsv(state, fromDate, toDate)
          : type === 'holdings'
            ? exportHoldingsCsv(state, toDate)
            : exportBalanceSheetCsv(state, toDate);
      registerExportResult(res, false, false);
    } catch (e) {
      setReportError(`CSV export failed: ${(e as Error).message}`);
    }
  };

  const handleCopyCsv = async () => {
    if (!lastDownload?.csvText) return;
    try {
      await navigator.clipboard.writeText(lastDownload.csvText);
      setCopiedCsv(true);
      window.setTimeout(() => setCopiedCsv(false), 2000);
    } catch {
      setPreviewOpen(true);
    }
  };

  const handlePrintPdf = () => {
    try {
      const frameWin = previewFrameRef.current?.contentWindow;
      if (frameWin) {
        frameWin.focus();
        frameWin.print();
        return;
      }
    } catch {
      // Fallback to browser window print if iframe print is restricted
    }
    window.print();
  };

  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          {
            label: t.kpiNetWorth,
            value: formatShillings(snapshot.nw, currency),
            sublabel: `${((snapshot.nw / target) * 100).toFixed(2)}% ${t.ofTarget}`,
          },
          {
            label: t.kpiWorkingCapital,
            value: formatShillings(snapshot.wc, currency),
            sublabel: t.currentMinusLiab,
          },
          {
            label: t.kpiPortfolioValue,
            value: formatShillings(snapshot.port, currency),
            sublabel: t.portfolioSub,
          },
          {
            label: t.kpiPeriodCashFlow,
            value: formatShillings(periodCashFlow, currency),
            tone: periodCashFlow > 0 ? 'positive' : periodCashFlow < 0 ? 'negative' : 'default',
            sublabel: periodLabel,
          },
        ]}
      />

      {/* Filter & Goal Settings Toolbar */}
      <section className="space-y-3 rounded-lg border border-[#242424] bg-[#121212] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-4">
            <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
              <span>{t.periodFrom}</span>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => onFromDateChange(e.target.value)}
                className="font-mono-nums h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:w-auto sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
              <span>{t.periodTo}</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => onToDateChange(e.target.value)}
                className="font-mono-nums h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:w-auto sm:text-sm"
              />
            </label>

            <label className="col-span-2 flex flex-col gap-1 text-xs text-[#9A9A9A] sm:col-span-1">
              <span>{t.targetNetWorth}</span>
              <input
                type="text"
                inputMode="decimal"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                onBlur={() => {
                  const parsed = Number(targetInput.replace(/,/g, '').trim());
                  if (Number.isFinite(parsed) && parsed > 0 && parsed !== settings.target) {
                    void onSaveSettings({ target: parsed });
                  } else {
                    setTargetInput(String(settings.target));
                  }
                }}
                className="font-mono-nums h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:w-44 sm:text-sm"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={onOpenSetup}
              className="inline-flex min-h-[42px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-[#2C2C2C] bg-[#0B0B0B] px-3 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white sm:h-9 sm:min-h-0 sm:px-3.5"
            >
              {t.setupAndFixed}
            </button>

            <button
              type="button"
              onClick={() => {
                if (!isPro) {
                  onRequirePro('ai_import');
                  return;
                }
                onOpenStatementImport();
              }}
              className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] bg-[#0B0B0B] px-3 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white sm:h-9 sm:min-h-0 sm:px-3.5"
            >
              {isPro ? (
                <Sparkles className="h-3.5 w-3.5 text-[#C1121F]" />
              ) : (
                <Lock className="h-3.5 w-3.5 text-[#C1121F]" />
              )}
              <span>{t.importStatementAi}</span>
            </button>

            <div
              role="group"
              aria-label="Language"
              className="inline-flex min-h-[42px] items-center rounded-md border border-[#2C2C2C] bg-[#0B0B0B] p-0.5 sm:h-9 sm:min-h-0"
            >
              {(['en', 'sw'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => void onSaveSettings({ language: lang })}
                  className={`flex-1 rounded px-2.5 py-1 text-xs font-semibold uppercase transition-colors sm:flex-initial ${
                    language === lang
                      ? 'bg-[#C1121F] text-white'
                      : 'text-[#9A9A9A] hover:text-white'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>

            <label className="flex min-h-[42px] cursor-pointer items-center gap-2 text-sm text-[#CCCCCC] sm:h-9 sm:min-h-0">
              <input
                type="checkbox"
                checked={settings.autoRefreshOnOpen}
                onChange={(e) => void onSaveSettings({ autoRefreshOnOpen: e.target.checked })}
                className="h-4 w-4 accent-[#C1121F]"
              />
              <span className="whitespace-nowrap">{t.autoUpdatePrices}</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[#1E1E1E] pt-3 text-xs">
          <span className="text-[#8A8A8A]">{t.quickRange}</span>
          {(
            [
              { key: 'this_month', label: t.thisMonth },
              { key: 'last_month', label: t.lastMonth },
              { key: 'last_90', label: t.last90Days },
              { key: 'ytd', label: t.yearToDate },
              { key: 'all', label: t.allDates },
            ] as const
          ).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyDatePreset(p.key)}
              className="min-h-[36px] rounded border border-[#282828] bg-[#0B0B0B] px-3 py-1.5 text-xs text-[#CCCCCC] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0 sm:px-2.5 sm:py-1"
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* Primary Charts: Net Worth Progress + Monthly Flows + Expenses Pie */}
      <section className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-3">
        <div className="rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">
              Net worth is {((snapshot.nw / target) * 100).toFixed(2)}% of target
            </h2>
            <span className="font-mono-nums text-xs text-[#8A8A8A]">
              Target {formatShillings(target, currency, 0)}
            </span>
          </div>

          <div className="space-y-3.5">
            {targetProgressItems.map((row) => {
              const barWidth = Math.max(0, Math.min(100, (row.pct / maxTargetPct) * 100));
              const targetMarkerLeft = (100 / maxTargetPct) * 100;

              return (
                <div key={row.label} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={row.accent ? 'font-semibold text-white' : 'text-[#B0B0B0]'}>
                      {row.label}
                    </span>
                    <span className="font-mono-nums text-right text-[#D4D4D4]">
                      {formatShillings(row.value, currency, 0)} · {row.pct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="relative h-5 w-full overflow-hidden rounded bg-[#1A1A1A]">
                    <div
                      className={`h-full transition-all duration-300 ${
                        row.accent ? 'bg-[#C1121F]' : 'bg-[#6F6F6F]'
                      }`}
                      style={{ width: `${barWidth}%` }}
                    />
                    <div
                      aria-hidden="true"
                      title="100% Target"
                      className="absolute inset-y-0 border-r border-dashed border-[#C1121F]/70"
                      style={{ left: `${targetMarkerLeft}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">
              Operating income vs expenses (12m)
            </h2>
            <div className="flex items-center gap-3 text-xs text-[#9A9A9A]">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 bg-[#C1121F]" />
                Income
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 bg-[#8E8E8E]" />
                Expenses
              </span>
            </div>
          </div>

          {monthlySeries.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-[#2A2A2A] px-6 py-10 text-center">
              <p className="text-sm text-[#9A9A9A]">
                No operating cash flow transactions recorded yet.
              </p>
              <button
                type="button"
                onClick={() => onNavigateTab('working-capital')}
                className="mt-3 min-h-[40px] rounded-md border border-[#303030] px-4 py-2 text-xs font-medium text-white transition-colors hover:border-[#C1121F]"
              >
                Log First Transaction
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-[280px] flex-1 items-end gap-2 pt-4">
                {monthlySeries.map((m) => {
                  const incH = Math.max(2, (m.income / maxMonthlyVal) * 150);
                  const expH = Math.max(2, (m.expenses / maxMonthlyVal) * 150);
                  return (
                    <div key={m.month} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-[156px] items-end gap-1">
                        <div
                          title={`${m.month} Income: ${formatShillings(m.income, currency)}`}
                          className="w-2.5 rounded-t-xs bg-[#C1121F] sm:w-3"
                          style={{ height: `${m.income > 0 ? incH : 0}px` }}
                        />
                        <div
                          title={`${m.month} Expenses: ${formatShillings(m.expenses, currency)}`}
                          className="w-2.5 rounded-t-xs bg-[#8E8E8E] sm:w-3"
                          style={{ height: `${m.expenses > 0 ? expH : 0}px` }}
                        />
                      </div>
                      <span className="font-mono-nums text-[10px] text-[#8A8A8A]">
                        {m.month.slice(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Expenses Pie Chart Card */}
        <div className="flex flex-col rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Expenses breakdown (period)</h2>
            <span className="font-mono-nums text-xs text-[#8A8A8A]">
              {formatShillings(expenseBreakdown.totalExpenses, currency, 0)}
            </span>
          </div>

          {expensePieSegments.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-[#2A2A2A] px-6 py-10 text-center">
              <p className="text-sm text-[#9A9A9A]">
                No expense outflows logged for {periodLabel}.
              </p>
              <button
                type="button"
                onClick={() => onNavigateTab('working-capital')}
                className="mt-3 rounded-md border border-[#303030] px-4 py-2 text-xs font-medium text-white transition-colors hover:border-[#C1121F]"
              >
                Log Expense
              </button>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
              <div className="relative flex shrink-0 items-center justify-center">
                <svg
                  width="160"
                  height="160"
                  viewBox="0 0 160 160"
                  role="img"
                  aria-label="Period expenses breakdown pie chart"
                >
                  <circle cx="80" cy="80" r="64" fill="none" stroke="#1E1E1E" strokeWidth="26" />
                  {expensePieSegments.map((seg) => (
                    <circle
                      key={seg.category}
                      cx="80"
                      cy="80"
                      r="64"
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="26"
                      strokeDasharray={seg.dashArray}
                      strokeDashoffset={seg.dashOffset}
                      transform="rotate(-90 80 80)"
                    >
                      <title>
                        {seg.category}: {formatShillings(seg.amount, currency, 0)} (
                        {seg.pct.toFixed(1)}%)
                      </title>
                    </circle>
                  ))}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[10px] text-[#8A8A8A]">Categories</span>
                  <span className="font-mono-nums text-sm font-semibold text-white">
                    {expensePieSegments.length}
                  </span>
                </div>
              </div>

              <div className="w-full min-w-0 flex-1 space-y-2">
                {expensePieSegments.map((seg) => (
                  <div key={seg.category} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2 text-[#D4D4D4]">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-xs"
                        style={{ backgroundColor: seg.color }}
                      />
                      <span className="truncate">{seg.category}</span>
                    </span>
                    <span className="font-mono-nums shrink-0 text-[#B0B0B0]">
                      {seg.pct.toFixed(0)}% · {formatShillings(seg.amount, currency, 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* PDF & CSV Financial Statements */}
      <section className="rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span>{t.reportsTitle}</span>
              {!isPro && <Lock className="h-3.5 w-3.5 text-[#C1121F]" />}
            </h2>
            <p className="mt-0.5 text-xs text-[#888888]">
              <span className="font-mono-nums text-[#D4D4D4]">{periodLabel}</span> · {t.reportsSubtitle}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={() => void handleCsvExport('cashflow')}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0"
            >
              {isPro ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5 text-[#C1121F]" />}
              Cash Flow CSV
            </button>
            <button
              type="button"
              onClick={() => void handleCsvExport('holdings')}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0"
            >
              {isPro ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5 text-[#C1121F]" />}
              Holdings CSV
            </button>
            <button
              type="button"
              onClick={() => void handleCsvExport('balance')}
              className="col-span-2 inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white sm:col-span-1 sm:min-h-0"
            >
              {isPro ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5 text-[#C1121F]" />}
              Balance Sheet CSV
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateAll()}
              className="col-span-2 inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] sm:col-span-1 sm:min-h-0"
            >
              {isPro ? <FileDown className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {t.generateAllPdf}
            </button>
          </div>
        </div>

        {!isPro && (
          <div className="mb-4 flex flex-col gap-3 rounded-md border border-[#7F1D1D]/70 bg-[#1B0A0C] px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[#F0D4D6]">{t.proLockedNotice}</span>
            <button
              type="button"
              onClick={() => onRequirePro('reports')}
              className="inline-flex min-h-[38px] shrink-0 items-center justify-center rounded-md bg-[#C1121F] px-4 py-1.5 font-semibold text-white transition-colors hover:bg-[#D91A28] sm:min-h-0"
            >
              {t.unlockProButton}
            </button>
          </div>
        )}

        {reportError && (
          <p className="mb-3 rounded-md border border-[#7F1D1D] bg-[#200A0C] px-4 py-2.5 text-xs text-red-400" role="alert">
            {reportError}
          </p>
        )}

        {lastDownload && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-4 py-2.5 text-xs"
          >
            <span className="text-emerald-400">{reportNotice}</span>
            <div className="flex flex-wrap items-center gap-3">
              {lastDownload.isPdf ? (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 font-medium text-[#E0E0E0] hover:text-white"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview / Print PDF
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleCopyCsv()}
                    className="inline-flex items-center gap-1.5 font-medium text-[#E0E0E0] hover:text-white"
                  >
                    {copiedCsv ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        Copied CSV
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy CSV
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="inline-flex items-center gap-1.5 font-medium text-[#E0E0E0] hover:text-white"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview CSV
                  </button>
                </>
              )}
              <a
                href={lastDownload.blobUrl}
                download={lastDownload.filename}
                className="inline-flex items-center gap-1.5 font-semibold text-[#C1121F] hover:underline"
              >
                <FileDown className="h-3.5 w-3.5" />
                Download {lastDownload.filename}
              </a>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {REPORT_DEFINITIONS.map((rep) => (
            <button
              key={rep.key}
              type="button"
              onClick={() => void handleGenerateSingle(rep.key)}
              className="flex items-center justify-between rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-4 py-3 text-left transition-colors hover:border-[#C1121F]"
            >
              <div>
                <p className="text-sm font-medium text-white">{rep.title}</p>
                <p className="mt-0.5 text-xs text-[#7E7E7E]">{rep.description}</p>
              </div>
              {isPro ? (
                <FileDown className="h-4 w-4 shrink-0 text-[#8A8A8A]" />
              ) : (
                <Lock className="h-4 w-4 shrink-0 text-[#C1121F]" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* In-app PDF & CSV Preview Modal (reliable inside sandboxed iframes) */}
      {previewOpen && lastDownload && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lastDownload.title}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
        >
          <div className="flex h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-[#2C2C2C] bg-[#121212] sm:h-[88vh] sm:rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242424] px-4 py-3 sm:gap-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-white">{lastDownload.title}</h3>
                <p className="font-mono-nums truncate text-xs text-[#8A8A8A]">
                  {lastDownload.filename}
                  {lastDownload.isPdf && lastDownload.pageCount
                    ? ` · ${lastDownload.pageCount} ${lastDownload.pageCount === 1 ? 'page' : 'pages'}`
                    : ''}
                  {!lastDownload.isPdf && typeof lastDownload.rowCount === 'number'
                    ? ` · ${lastDownload.rowCount} ${lastDownload.rowCount === 1 ? 'row' : 'rows'}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {lastDownload.isPdf ? (
                  <button
                    type="button"
                    onClick={handlePrintPdf}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-[#323232] bg-[#1A1A1A] px-3 py-1.5 text-xs font-medium text-white hover:border-[#C1121F]"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Print / Save PDF</span>
                    <span className="sm:hidden">Print</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleCopyCsv()}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-[#323232] bg-[#1A1A1A] px-3 py-1.5 text-xs font-medium text-white hover:border-[#C1121F]"
                  >
                    {copiedCsv ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedCsv ? 'Copied' : 'Copy CSV'}
                  </button>
                )}
                <a
                  href={lastDownload.blobUrl}
                  download={lastDownload.filename}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-[#C1121F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#D91A28]"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {lastDownload.isPdf ? 'Save PDF' : 'Save CSV'}
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="Close preview"
                  className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded text-[#9A9A9A] hover:bg-[#222222] hover:text-white sm:min-h-0 sm:min-w-0 sm:p-1.5"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {lastDownload.isPdf ? (
              <>
                <iframe
                  ref={previewFrameRef}
                  src={lastDownload.blobUrl}
                  title={lastDownload.title}
                  className="h-full w-full flex-1 bg-white"
                />
                <div className="pb-safe border-t border-[#242424] bg-[#0B0B0B] px-4 py-2 text-[11px] text-[#8A8A8A] sm:px-5">
                  If your browser preview blocks direct file downloads, click Print / Save PDF or open the app in a standalone tab.
                </div>
              </>
            ) : (
              <pre className="font-mono-nums pb-safe h-full w-full flex-1 overflow-auto bg-[#0B0B0B] p-4 text-xs leading-relaxed text-[#E0E0E0] sm:p-5">
                {lastDownload.csvText || ''}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
