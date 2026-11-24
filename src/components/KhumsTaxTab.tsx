import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Calculator,
  Check,
  Crown,
  Eye,
  FileDown,
  Lock,
  Printer,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import type {
  AppLanguage,
  FinanceState,
  KhumsMethod,
  KhumsTaxConfig,
  TraEmploymentMode,
  TraPayFrequency,
} from '../types';
import { formatShillings } from '../utils/format';
import { getTranslations } from '../utils/i18n';
import {
  buildPrefillFromState,
  calculateSistaniKhums,
  calculateTanzaniaTaxes,
  createDefaultKhumsTaxConfig,
  mergeKhumsTaxConfig,
} from '../utils/khumsAndTaxes';
import { generateKhumsTaxPdf, type GeneratedPdfResult } from '../utils/pdfReports';
import { KpiStrip } from './KpiStrip';

interface KhumsTaxTabProps {
  state: FinanceState;
  language: AppLanguage;
  onSaveConfig: (config: KhumsTaxConfig) => Promise<void>;
  onToggleKhums: (enabled: boolean) => Promise<void>;
  onRequirePro: (feature: 'taxes') => void;
}

interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  onChange: (next: number) => void;
  max?: number;
  suffix?: string;
}

function formatNumericDisplay(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  max,
  suffix = 'TZS',
}: NumberFieldProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => formatNumericDisplay(value));

  useEffect(() => {
    if (!focused) {
      setDraft(formatNumericDisplay(value));
    }
  }, [value, focused]);

  const parseDraft = (raw: string): number => {
    const cleaned = raw.replace(/,/g, '').trim();
    if (!cleaned || cleaned === '.') return 0;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) return 0;
    return typeof max === 'number' ? Math.min(max, n) : n;
  };

  return (
    <label className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-[#D4D4D4]">{label}</span>
        {hint && <span className="text-[11px] text-[#7A7A7A]">{hint}</span>}
      </div>
      <div className="relative flex items-center">
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          onFocus={() => {
            setFocused(true);
            setDraft(value > 0 ? String(value) : '');
          }}
          onChange={(e) => {
            const raw = e.target.value;
            if (!/^[0-9,]*\.?[0-9]*$/.test(raw)) return;
            setDraft(raw);
            onChange(parseDraft(raw));
          }}
          onBlur={() => {
            const parsed = parseDraft(draft);
            setFocused(false);
            setDraft(formatNumericDisplay(parsed));
            onChange(parsed);
          }}
          placeholder="0"
          className="font-mono-nums h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] pr-14 pl-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
        />
        <span className="font-mono-nums pointer-events-none absolute right-3 text-[11px] text-[#737373]">
          {suffix}
        </span>
      </div>
    </label>
  );
}

export function KhumsTaxTab({
  state,
  language,
  onSaveConfig,
  onToggleKhums,
  onRequirePro,
}: KhumsTaxTabProps) {
  const t = getTranslations(language);
  const isPro = state.settings.plan === 'pro';
  const khumsEnabled = state.settings.khumsEnabled !== false;
  const [config, setConfig] = useState<KhumsTaxConfig>(() =>
    mergeKhumsTaxConfig(state.khumsTaxConfig)
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorNotice, setErrorNotice] = useState('');
  const [lastPdf, setLastPdf] = useState<GeneratedPdfResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const dirtyRef = useRef(false);
  const prevPdfUrlRef = useRef<string | null>(null);
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const onSaveRef = useRef(onSaveConfig);
  onSaveRef.current = onSaveConfig;

  useEffect(() => {
    if (state.khumsTaxConfig && !dirtyRef.current) {
      setConfig(mergeKhumsTaxConfig(state.khumsTaxConfig));
    }
  }, [state.khumsTaxConfig]);

  useEffect(() => {
    return () => {
      if (prevPdfUrlRef.current) {
        URL.revokeObjectURL(prevPdfUrlRef.current);
      }
    };
  }, []);

  // Auto-save edits after 800ms so switching tabs preserves TRA & Khums entries (Pro only)
  useEffect(() => {
    if (!isPro || !dirtyRef.current) return;
    const timer = window.setTimeout(async () => {
      try {
        await onSaveRef.current(config);
        dirtyRef.current = false;
      } catch (e) {
        setErrorNotice(`Auto-save failed: ${(e as Error).message}`);
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [config]);

  const khums = useMemo(() => calculateSistaniKhums(config), [config]);
  const taxes = useMemo(() => calculateTanzaniaTaxes(config), [config]);

  const updateField = <K extends keyof KhumsTaxConfig>(key: K, val: KhumsTaxConfig[K]) => {
    dirtyRef.current = true;
    setConfig((prev) => ({ ...prev, [key]: val }));
    if (notice) setNotice('');
    if (errorNotice) setErrorNotice('');
  };

  const handlePrefill = () => {
    const next = buildPrefillFromState(config, state);
    dirtyRef.current = true;
    setConfig(next);
    setErrorNotice('');
    setNotice('Loaded live balances, investments & 12-month ledger flows into calculators.');
  };

  const handleSyncTaxIncomeToKhums = () => {
    dirtyRef.current = true;
    setConfig((prev) => ({
      ...prev,
      khumsMethod: 'income_flow',
      khumsAnnualNetIncome: Math.round(taxes.totalAnnualNetAfterTax),
    }));
    setErrorNotice('');
    setNotice('Synced Tanzania net after-tax annual income into Khums Income Flow.');
  };

  const handleReset = () => {
    const def = createDefaultKhumsTaxConfig();
    dirtyRef.current = true;
    setConfig(def);
    setErrorNotice('');
    setNotice('Calculator inputs reset to zero.');
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice('');
    setErrorNotice('');
    try {
      await onSaveConfig(config);
      dirtyRef.current = false;
      setNotice('Calculator figures saved to your FinanceDesk account.');
    } catch (e) {
      setErrorNotice(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExportPdf = () => {
    setErrorNotice('');
    try {
      const traRows = [
        {
          label: 'Employment Income PAYE',
          basis: formatShillings(taxes.annualTaxableEmployment, 'TZS', 0),
          rate:
            config.traEmploymentMode === 'resident_primary'
              ? `Up to ${taxes.marginalRatePct.toFixed(0)}%`
              : config.traEmploymentMode === 'resident_secondary'
                ? '30% flat'
                : '15% flat',
          tax: taxes.annualPaye,
        },
        {
          label: 'Secondary Employment Income',
          basis: formatShillings(config.traSecondaryIncomeAnnual, 'TZS', 0),
          rate: '30%',
          tax: taxes.secondaryIncomeTax,
        },
        {
          label: 'DSE-Listed Dividends',
          basis: formatShillings(config.traDseDividendsAnnual, 'TZS', 0),
          rate: '5% WHT',
          tax: taxes.dseDividendTax,
        },
        {
          label: 'Unlisted Company Dividends',
          basis: formatShillings(config.traUnlistedDividendsAnnual, 'TZS', 0),
          rate: '10% WHT',
          tax: taxes.unlistedDividendTax,
        },
        {
          label: 'DSE-Listed Capital Gains',
          basis: formatShillings(config.traDseCapitalGainsAnnual, 'TZS', 0),
          rate: config.traDseBelow25Pct ? '0% (<25%)' : '10% CGT',
          tax: taxes.dseCapitalGainsTax,
        },
        {
          label: 'Unlisted / Property Capital Gains',
          basis: formatShillings(config.traUnlistedCapitalGainsAnnual, 'TZS', 0),
          rate: '10% CGT',
          tax: taxes.unlistedCapitalGainsTax,
        },
        {
          label: 'Rental / Interest / Other Income',
          basis: formatShillings(config.traRentalInterestAnnual, 'TZS', 0),
          rate: '10% WHT',
          tax: taxes.rentalInterestTax,
        },
      ];

      const res = generateKhumsTaxPdf({
        includeKhums: khumsEnabled,
        khumsYearDate: config.khumsYearDate,
        khumsItems: khums.items,
        totalKhums: khums.totalKhums,
        sahmAlImam: khums.sahmAlImam,
        sahmAlSadat: khums.sahmAlSadat,
        retainedAfterKhums: khums.retainedAfterKhums,
        traRows,
        totalAnnualTax: taxes.totalAnnualTaxLiability,
        totalNetAfterTax: taxes.totalAnnualNetAfterTax,
        effectiveRatePct: taxes.effectiveTaxRatePct,
      });

      if (prevPdfUrlRef.current && prevPdfUrlRef.current !== res.blobUrl) {
        URL.revokeObjectURL(prevPdfUrlRef.current);
      }
      prevPdfUrlRef.current = res.blobUrl;
      setLastPdf(res);
      setNotice(`Prepared ${res.filename}`);
      setPreviewOpen(true);
    } catch (e) {
      setErrorNotice(`PDF export failed: ${(e as Error).message}`);
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

  if (!isPro) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold tracking-wider text-[#C1121F] uppercase">
                <Crown className="h-4 w-4" />
                {t.planProTitle} · $5
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                {t.taxesPaywallTitle}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#A5A5A5]">{t.taxesPaywallBody}</p>
            </div>

            <label className="flex min-h-[42px] shrink-0 cursor-pointer items-center gap-2.5 self-start rounded-md border border-[#282828] bg-[#0B0B0B] px-3 py-2 text-xs text-[#D4D4D4]">
              <input
                type="checkbox"
                checked={khumsEnabled}
                onChange={(e) => void onToggleKhums(e.target.checked)}
                className="h-4 w-4 accent-[#C1121F]"
              />
              <span className="whitespace-nowrap">
                {t.khumsToggleLabel}: {khumsEnabled ? t.khumsOn : t.khumsOff}
              </span>
            </label>
          </div>

          <ul className="mt-5 space-y-2.5 rounded-lg border border-[#242424] bg-[#0B0B0B] p-4">
            {t.taxesPaywallBullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2.5 text-xs text-[#E0E0E0]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#C1121F]" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#222222] pt-4">
            <span className="font-mono-nums text-xs text-[#9A9A9A]">
              $5.00 USD (~TZS 13,250)
            </span>
            <button
              type="button"
              onClick={() => onRequirePro('taxes')}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-[#C1121F] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#D91A28]"
            >
              <Lock className="h-4 w-4" />
              {t.unlockProButton}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <KpiStrip
        items={
          khumsEnabled
            ? [
                {
                  label: 'Total Khums due (20%)',
                  value: formatShillings(khums.totalKhums, 'TZS', 0),
                  tone: khums.totalKhums > 0 ? 'negative' : 'default',
                  sublabel: `Surplus: ${formatShillings(khums.netSurplus, 'TZS', 0)} · Al-Sistani`,
                },
                {
                  label: 'Sahm al-Imam & Sadat (50/50)',
                  value: formatShillings(khums.sahmAlImam, 'TZS', 0),
                  sublabel: `Each share · Retained 80%: ${formatShillings(khums.retainedAfterKhums, 'TZS', 0)}`,
                },
                {
                  label: 'Annual Tanzania tax (TRA)',
                  value: formatShillings(taxes.totalAnnualTaxLiability, 'TZS', 0),
                  tone: taxes.totalAnnualTaxLiability > 0 ? 'negative' : 'default',
                  sublabel: `Eff. ${taxes.effectiveTaxRatePct.toFixed(2)}% · Monthly PAYE ${formatShillings(taxes.monthlyPaye, 'TZS', 0)}`,
                },
                {
                  label: 'Annual net after tax & NSSF',
                  value: formatShillings(taxes.totalAnnualNetAfterTax, 'TZS', 0),
                  tone: taxes.totalAnnualNetAfterTax > 0 ? 'positive' : 'default',
                  sublabel: `Monthly take-home: ${formatShillings(taxes.netMonthlyTakeHome, 'TZS', 0)}`,
                },
              ]
            : [
                {
                  label: 'Annual Tanzania tax (TRA)',
                  value: formatShillings(taxes.totalAnnualTaxLiability, 'TZS', 0),
                  tone: taxes.totalAnnualTaxLiability > 0 ? 'negative' : 'default',
                  sublabel: `Eff. ${taxes.effectiveTaxRatePct.toFixed(2)}% · PAYE + WHT + CGT`,
                },
                {
                  label: 'Monthly PAYE deduction',
                  value: formatShillings(taxes.monthlyPaye, 'TZS', 0),
                  tone: taxes.monthlyPaye > 0 ? 'negative' : 'default',
                  sublabel: `Taxable pay: ${formatShillings(taxes.monthlyTaxableEmployment, 'TZS', 0)} / mo`,
                },
                {
                  label: 'Annual NSSF / PSSSF',
                  value: formatShillings(taxes.annualNssfDeduction, 'TZS', 0),
                  sublabel: `${config.traNssfRatePct}% statutory pension share`,
                },
                {
                  label: 'Annual net after tax & NSSF',
                  value: formatShillings(taxes.totalAnnualNetAfterTax, 'TZS', 0),
                  tone: taxes.totalAnnualNetAfterTax > 0 ? 'positive' : 'default',
                  sublabel: `Monthly take-home: ${formatShillings(taxes.netMonthlyTakeHome, 'TZS', 0)}`,
                },
              ]
        }
      />

      {/* Action & Date Toolbar */}
      <section className="flex flex-col gap-4 rounded-lg border border-[#242424] bg-[#121212] px-4 py-4 sm:px-5 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-4">
          {khumsEnabled && (
            <label className="flex w-full flex-col gap-1 text-xs text-[#9A9A9A] sm:w-auto">
              <span>Ra&apos;s al-Sanah (Khums Year Date)</span>
              <input
                type="date"
                value={config.khumsYearDate}
                onChange={(e) => updateField('khumsYearDate', e.target.value)}
                className="font-mono-nums h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:w-auto sm:text-sm"
              />
            </label>
          )}
          <div className="text-xs text-[#888888]">
            <p className="font-medium text-[#D4D4D4]">
              {khumsEnabled
                ? "Marja': Grand Ayatollah al-Sistani · TRA Jurisdiction"
                : 'Tanzania Revenue Authority (TRA) Jurisdiction'}
            </p>
            <p className="mt-0.5">All obligations calculated strictly in Tanzanian Shillings (TZS).</p>
          </div>
          <label className="flex min-h-[42px] w-full cursor-pointer items-center gap-2.5 rounded-md border border-[#282828] bg-[#0B0B0B] px-3 text-xs text-[#D4D4D4] sm:h-9 sm:min-h-0 sm:w-auto">
            <input
              type="checkbox"
              checked={khumsEnabled}
              onChange={(e) => void onToggleKhums(e.target.checked)}
              className="h-4 w-4 accent-[#C1121F] sm:h-3.5 sm:w-3.5"
            />
            <span className="whitespace-nowrap">
              {t.khumsToggleLabel} {khumsEnabled ? t.khumsOn : t.khumsOff}
            </span>
          </label>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2.5">
          <button
            type="button"
            onClick={handlePrefill}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[#303030] bg-[#0B0B0B] px-3 py-2 text-xs font-medium text-white transition-colors hover:border-[#C1121F] sm:min-h-0 sm:px-3.5"
          >
            <ArrowDownToLine className="h-3.5 w-3.5 text-[#C1121F]" />
            Prefill Ledger
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[#303030] bg-[#0B0B0B] px-3 py-2 text-xs font-medium text-white transition-colors hover:border-[#C1121F] disabled:opacity-50 sm:min-h-0 sm:px-3.5"
          >
            <Save className="h-3.5 w-3.5 text-[#CCCCCC]" />
            {saving ? 'Saving...' : 'Save Inputs'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#BDBDBD] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#C1121F] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] sm:min-h-0 sm:px-4"
          >
            <FileDown className="h-3.5 w-3.5" />
            Export PDF
          </button>
        </div>
      </section>

      {errorNotice && (
        <div
          role="alert"
          className="rounded-md border border-[#7F1D1D] bg-[#200A0C] px-4 py-2.5 text-xs text-red-400"
        >
          {errorNotice}
        </div>
      )}

      {(notice || lastPdf) && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#262626] bg-[#121212] px-4 py-2.5 text-xs"
        >
          <div className="flex items-center gap-2 text-emerald-400">
            <Check className="h-3.5 w-3.5 shrink-0" />
            <span>{notice || (lastPdf ? `Prepared ${lastPdf.filename}` : '')}</span>
          </div>
          {lastPdf && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="inline-flex items-center gap-1.5 font-medium text-[#E0E0E0] hover:text-white"
              >
                <Eye className="h-3.5 w-3.5" />
                Preview / Print PDF
              </button>
              <a
                href={lastPdf.blobUrl}
                download={lastPdf.filename}
                className="inline-flex items-center gap-1.5 font-semibold text-[#C1121F] hover:underline"
              >
                <FileDown className="h-3.5 w-3.5" />
                Download {lastPdf.filename}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Calculator Grid */}
      <div className={`grid grid-cols-1 gap-6 ${khumsEnabled ? 'xl:grid-cols-2' : ''}`}>
        {/* LEFT: KHUMS (AYATOLLAH AL-SISTANI) */}
        {khumsEnabled && (
        <section className="flex flex-col rounded-lg border border-[#242424] bg-[#121212]">
          <div className="flex flex-col gap-3 border-b border-[#222222] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-white">
                <Calculator className="h-4 w-4 text-[#C1121F]" />
                Khums Calculator — Ayatollah al-Sistani
              </h2>
              <p className="mt-0.5 text-xs text-[#8A8A8A]">
                20% (1/5) on annual surplus unspent on Ra&apos;s al-Sanah
              </p>
            </div>

            <div className="grid w-full grid-cols-2 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] p-0.5 sm:flex sm:w-auto">
              {(
                [
                  { key: 'wealth', label: 'Year-End Wealth' },
                  { key: 'income_flow', label: "Income vs Ma'unah" },
                ] as Array<{ key: KhumsMethod; label: string }>
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => updateField('khumsMethod', m.key)}
                  className={`min-h-[38px] whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
                    config.khumsMethod === m.key
                      ? 'bg-[#C1121F] text-white'
                      : 'text-[#9A9A9A] hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            {config.khumsMethod === 'wealth' ? (
              <>
                <div className="space-y-3">
                  <p className="text-xs font-semibold tracking-wider text-[#9A9A9A] uppercase">
                    Assessable Year-End Balances &amp; Supplies
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <NumberField
                      label="Cash in bank"
                      hint="Selcom, Stanbic, Tigo Pesa"
                      value={config.khumsBankCash}
                      onChange={(v) => updateField('khumsBankCash', v)}
                    />
                    <NumberField
                      label="Cash in hand"
                      value={config.khumsHandCash}
                      onChange={(v) => updateField('khumsHandCash', v)}
                    />
                    <NumberField
                      label="Investments market value"
                      hint="DSE, iTrust ETFs, UTT AMIS"
                      value={config.khumsPortfolioValue}
                      onChange={(v) => updateField('khumsPortfolioValue', v)}
                    />
                    <NumberField
                      label="Unconsumed household supplies"
                      hint="Food / fuel unused at year-end"
                      value={config.khumsConsumablesValue}
                      onChange={(v) => updateField('khumsConsumablesValue', v)}
                    />
                    <NumberField
                      label="Collectible earnings receivables"
                      hint="Owed from this year's earnings"
                      value={config.khumsReceivables}
                      onChange={(v) => updateField('khumsReceivables', v)}
                    />
                  </div>
                </div>

                <div className="space-y-3 border-t border-[#202020] pt-4">
                  <p className="text-xs font-semibold tracking-wider text-[#9A9A9A] uppercase">
                    Allowable Exemptions &amp; Deductions (Al-Sistani)
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <NumberField
                      label="Prior khums-paid principal"
                      hint="Avoids double-paying on old capital"
                      value={config.khumsPriorPaidBasis}
                      onChange={(v) => updateField('khumsPriorPaidBasis', v)}
                    />
                    <NumberField
                      label="Exempt receipts"
                      hint="Inheritance, Mahr, exempt gifts"
                      value={config.khumsExemptReceipts}
                      onChange={(v) => updateField('khumsExemptReceipts', v)}
                    />
                    <NumberField
                      label="Unpaid current-year Ma'unah debt"
                      hint="Living expense debt of this year"
                      value={config.khumsMaunahDebt}
                      onChange={(v) => updateField('khumsMaunahDebt', v)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold tracking-wider text-[#9A9A9A] uppercase">
                    Annual Surplus Flow (Earnings Minus Ma&apos;unah)
                  </p>
                  <button
                    type="button"
                    onClick={handleSyncTaxIncomeToKhums}
                    className="text-xs font-medium text-[#C1121F] hover:underline"
                  >
                    Use TRA After-Tax Income ({formatShillings(taxes.totalAnnualNetAfterTax, 'TZS', 0)})
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Annual net earnings (after tax)"
                    hint="Salary, business & dividend net"
                    value={config.khumsAnnualNetIncome}
                    onChange={(v) => updateField('khumsAnnualNetIncome', v)}
                  />
                  <NumberField
                    label="Annual Ma'unah living expenses"
                    hint="Rent, food, transport, family, health"
                    value={config.khumsAnnualMaunahExpense}
                    onChange={(v) => updateField('khumsAnnualMaunahExpense', v)}
                  />
                  <NumberField
                    label="Prior khums-paid additions"
                    value={config.khumsPriorPaidBasis}
                    onChange={(v) => updateField('khumsPriorPaidBasis', v)}
                  />
                  <NumberField
                    label="Exempt receipts in cashflow"
                    hint="Inheritance, Mahr"
                    value={config.khumsExemptReceipts}
                    onChange={(v) => updateField('khumsExemptReceipts', v)}
                  />
                </div>
              </div>
            )}

            {/* Khums Computation Ledger */}
            <div className="overflow-x-auto border-t border-[#202020] pt-4">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#242424] text-[#8A8A8A]">
                    <th className="py-2 font-medium">Khums Computation Line</th>
                    <th className="py-2 text-right font-medium">Amount (TZS)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1D1D]">
                  {khums.items.map((row) => (
                    <tr
                      key={row.label}
                      className={row.sign === '=' ? 'bg-[#171717] font-semibold text-white' : 'text-[#CCCCCC]'}
                    >
                      <td className="py-2 pr-3">
                        <span className="font-mono-nums mr-2 text-[#8A8A8A]">{row.sign}</span>
                        {row.label}
                      </td>
                      <td className="font-mono-nums py-2 text-right">
                        {row.sign === '-' && row.amount > 0 ? '-' : ''}
                        {formatShillings(row.amount, 'TZS', 0)}
                      </td>
                    </tr>
                  ))}
                  {khums.rawSurplus < 0 && (
                    <tr>
                      <td colSpan={2} className="py-2 text-[11px] text-[#9A9A9A]">
                        Deductions exceed assessable base by{' '}
                        <span className="font-mono-nums text-white">
                          {formatShillings(Math.abs(khums.rawSurplus), 'TZS', 0)}
                        </span>{' '}
                        — no Khums is obligatory this year.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mandatory Distribution Split */}
            <div className="grid grid-cols-1 gap-3 border-t border-[#202020] pt-4 sm:grid-cols-3">
              <div className="rounded-md border border-[#262626] bg-[#0B0B0B] px-3.5 py-3">
                <p className="text-[11px] text-[#8A8A8A]">Total Khums Due (20%)</p>
                <p className="font-mono-nums mt-1 text-base font-semibold text-[#C1121F]">
                  {formatShillings(khums.totalKhums, 'TZS', 0)}
                </p>
              </div>
              <div className="rounded-md border border-[#262626] bg-[#0B0B0B] px-3.5 py-3">
                <p className="text-[11px] text-[#8A8A8A]">Sahm al-Imam (50%)</p>
                <p className="font-mono-nums mt-1 text-base font-semibold text-white">
                  {formatShillings(khums.sahmAlImam, 'TZS', 0)}
                </p>
              </div>
              <div className="rounded-md border border-[#262626] bg-[#0B0B0B] px-3.5 py-3">
                <p className="text-[11px] text-[#8A8A8A]">Sahm al-Sadat (50%)</p>
                <p className="font-mono-nums mt-1 text-base font-semibold text-white">
                  {formatShillings(khums.sahmAlSadat, 'TZS', 0)}
                </p>
              </div>
            </div>

            {/* Fiqh Notes */}
            <div className="space-y-1.5 border-t border-[#202020] pt-4 text-[11px] leading-relaxed text-[#8C8C8C]">
              <p className="font-semibold text-[#C8C8C8]">Key Rulings (Ayatollah al-Sistani)</p>
              <p>
                1. Khums (20%) applies once a year on your fixed <span className="text-[#D4D4D4]">Ra&apos;s al-Sanah</span> to surplus earnings, bank balances, and unconsumed supplies above annual <span className="text-[#D4D4D4]">Ma&apos;unah</span>.
              </p>
              <p>
                2. Shares &amp; UTT AMIS units held for investment/resale are assessed at year-end market value; deduct your previously khums-paid capital so you do not pay twice on the same principal.
              </p>
              <p>
                3. <span className="text-[#D4D4D4]">Sahm al-Imam</span> (50%) is paid to the Marja&apos; or his authorized <span className="text-[#D4D4D4]">wakil</span>; <span className="text-[#D4D4D4]">Sahm al-Sadat</span> (50%) goes to eligible needy Hashimite Sayyids (with permission where required).
              </p>
            </div>
          </div>
        </section>
        )}

        {/* RIGHT: TANZANIA TAX CALCULATOR (TRA) */}
        <section className="flex flex-col rounded-lg border border-[#242424] bg-[#121212]">
          <div className="flex flex-col gap-3 border-b border-[#222222] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5">
            <div>
              <h2 className="text-base font-semibold text-white">
                Tanzania Tax Calculator — TRA
              </h2>
              <p className="mt-0.5 text-xs text-[#8A8A8A]">
                PAYE progressive slabs, NSSF/PSSSF, DSE dividends &amp; capital gains
              </p>
            </div>

            <div className="grid w-full grid-cols-2 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] p-0.5 sm:flex sm:w-auto">
              {(
                [
                  { key: 'monthly', label: 'Monthly Pay' },
                  { key: 'annual', label: 'Annual Pay' },
                ] as Array<{ key: TraPayFrequency; label: string }>
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => updateField('traPayFrequency', f.key)}
                  className={`min-h-[38px] whitespace-nowrap rounded px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0 ${
                    config.traPayFrequency === f.key
                      ? 'bg-[#C1121F] text-white'
                      : 'text-[#9A9A9A] hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            {/* Employment Income */}
            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wider text-[#9A9A9A] uppercase">
                Employment Income &amp; Statutory Pension (PAYE)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-[#D4D4D4]">Employment status</span>
                  <select
                    value={config.traEmploymentMode}
                    onChange={(e) =>
                      updateField('traEmploymentMode', e.target.value as TraEmploymentMode)
                    }
                    className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
                  >
                    <option value="resident_primary">Resident (Primary)</option>
                    <option value="resident_secondary">Resident Secondary (30%)</option>
                    <option value="non_resident">Non-Resident (15%)</option>
                  </select>
                </label>

                <NumberField
                  label={
                    config.traPayFrequency === 'annual'
                      ? 'Gross annual salary'
                      : 'Gross monthly salary'
                  }
                  value={config.traGrossPay}
                  onChange={(v) => updateField('traGrossPay', v)}
                />

                <NumberField
                  label="NSSF / PSSSF rate"
                  hint="Employee share"
                  value={config.traNssfRatePct}
                  onChange={(v) => updateField('traNssfRatePct', Math.min(50, v))}
                  max={50}
                  suffix="%"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-[#262626] bg-[#0B0B0B] px-3.5 py-2.5">
                  <p className="text-[11px] text-[#8A8A8A]">Monthly Taxable Pay</p>
                  <p className="font-mono-nums mt-0.5 text-sm font-semibold text-white">
                    {formatShillings(taxes.monthlyTaxableEmployment, 'TZS', 0)}
                  </p>
                </div>
                <div className="rounded-md border border-[#262626] bg-[#0B0B0B] px-3.5 py-2.5">
                  <p className="text-[11px] text-[#8A8A8A]">Monthly PAYE</p>
                  <p className="font-mono-nums mt-0.5 text-sm font-semibold text-[#C1121F]">
                    {formatShillings(taxes.monthlyPaye, 'TZS', 0)}
                  </p>
                </div>
                <div className="rounded-md border border-[#262626] bg-[#0B0B0B] px-3.5 py-2.5">
                  <p className="text-[11px] text-[#8A8A8A]">Net Monthly Take-Home</p>
                  <p className="font-mono-nums mt-0.5 text-sm font-semibold text-emerald-400">
                    {formatShillings(taxes.netMonthlyTakeHome, 'TZS', 0)}
                  </p>
                </div>
              </div>
            </div>

            {/* TRA PAYE Bracket Breakdown */}
            <div className="overflow-x-auto border-t border-[#202020] pt-4">
              <p className="mb-2 text-xs font-semibold tracking-wider text-[#9A9A9A] uppercase">
                TRA Monthly PAYE Bracket Breakdown
              </p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#242424] text-[#8A8A8A]">
                    <th className="py-1.5 font-medium">Monthly Band (TZS)</th>
                    <th className="py-1.5 text-right font-medium">Rate</th>
                    <th className="py-1.5 text-right font-medium">Taxable Slice</th>
                    <th className="py-1.5 text-right font-medium">Monthly Tax</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1D1D]">
                  {taxes.payeBrackets.map((b) => (
                    <tr
                      key={b.label}
                      className={b.taxableInBand > 0 ? 'text-[#E5E5E5]' : 'text-[#666666]'}
                    >
                      <td className="py-1.5 pr-2">{b.rangeLabel}</td>
                      <td className="font-mono-nums py-1.5 text-right">{b.ratePct}%</td>
                      <td className="font-mono-nums py-1.5 text-right">
                        {formatShillings(b.taxableInBand, 'TZS', 0)}
                      </td>
                      <td className="font-mono-nums py-1.5 text-right">
                        {formatShillings(b.monthlyTax, 'TZS', 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Investment, Dividends & Capital Gains */}
            <div className="space-y-3 border-t border-[#202020] pt-4">
              <p className="text-xs font-semibold tracking-wider text-[#9A9A9A] uppercase">
                Annual Investments, Capital Gains &amp; Secondary Income
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberField
                  label="DSE-listed dividends (annual)"
                  hint="5% final WHT"
                  value={config.traDseDividendsAnnual}
                  onChange={(v) => updateField('traDseDividendsAnnual', v)}
                />
                <NumberField
                  label="Unlisted dividends (annual)"
                  hint="10% final WHT"
                  value={config.traUnlistedDividendsAnnual}
                  onChange={(v) => updateField('traUnlistedDividendsAnnual', v)}
                />
                <NumberField
                  label="DSE realized capital gains"
                  hint={config.traDseBelow25Pct ? '0% exempt (<25% stake)' : '10% CGT'}
                  value={config.traDseCapitalGainsAnnual}
                  onChange={(v) => updateField('traDseCapitalGainsAnnual', v)}
                />
                <NumberField
                  label="Unlisted / property net gains"
                  hint="10% CGT"
                  value={config.traUnlistedCapitalGainsAnnual}
                  onChange={(v) => updateField('traUnlistedCapitalGainsAnnual', v)}
                />
                <NumberField
                  label="Secondary employment (annual)"
                  hint="30% flat"
                  value={config.traSecondaryIncomeAnnual}
                  onChange={(v) => updateField('traSecondaryIncomeAnnual', v)}
                />
                <NumberField
                  label="Rental / interest income (annual)"
                  hint="10% WHT"
                  value={config.traRentalInterestAnnual}
                  onChange={(v) => updateField('traRentalInterestAnnual', v)}
                />
              </div>

              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 pt-1 text-xs text-[#CCCCCC] sm:min-h-0">
                <input
                  type="checkbox"
                  checked={config.traDseBelow25Pct}
                  onChange={(e) => updateField('traDseBelow25Pct', e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-[#C1121F]"
                />
                <span>
                  DSE shareholding is below 25% of issued shares (Exempt from Capital Gains Tax under ITA)
                </span>
              </label>
            </div>

            {/* Annual Tanzania Summary */}
            <div className="overflow-x-auto border-t border-[#202020] pt-4">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#242424] text-[#8A8A8A]">
                    <th className="py-1.5 font-medium">Annual TRA Obligation</th>
                    <th className="py-1.5 text-right font-medium">Annual Amount (TZS)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1D1D] text-[#CCCCCC]">
                  <tr>
                    <td className="py-1.5">Primary Employment PAYE (Annualized)</td>
                    <td className="font-mono-nums py-1.5 text-right">
                      {formatShillings(taxes.annualPaye, 'TZS', 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5">DSE &amp; Unlisted Dividends WHT (5% / 10%)</td>
                    <td className="font-mono-nums py-1.5 text-right">
                      {formatShillings(taxes.dseDividendTax + taxes.unlistedDividendTax, 'TZS', 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5">Capital Gains, Secondary &amp; WHT Income Tax</td>
                    <td className="font-mono-nums py-1.5 text-right">
                      {formatShillings(
                        taxes.dseCapitalGainsTax +
                          taxes.unlistedCapitalGainsTax +
                          taxes.secondaryIncomeTax +
                          taxes.rentalInterestTax,
                        'TZS',
                        0
                      )}
                    </td>
                  </tr>
                  <tr className="bg-[#171717] font-semibold text-white">
                    <td className="py-2">Total Annual Tanzania Tax (TRA)</td>
                    <td className="font-mono-nums py-2 text-right text-[#C1121F]">
                      {formatShillings(taxes.totalAnnualTaxLiability, 'TZS', 0)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-[#9A9A9A]">Employee NSSF / PSSSF Contribution (Annual)</td>
                    <td className="font-mono-nums py-1.5 text-right text-[#9A9A9A]">
                      {formatShillings(taxes.annualNssfDeduction, 'TZS', 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="space-y-1.5 border-t border-[#202020] pt-4 text-[11px] leading-relaxed text-[#8C8C8C]">
              <p className="font-semibold text-[#C8C8C8]">TRA Statutory Reference Notes</p>
              <p>
                1. Resident annual tax-free threshold is TZS 3,240,000 (TZS 270,000/month), applied after deducting mandatory employee NSSF/PSSSF pension contributions.
              </p>
              <p>
                2. DSE-listed dividends carry a 5% final WHT (vs 10% for unlisted shares); secondary market DSE trades are exempt from stamp duty and CGT when holding &lt;25%.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* In-app PDF Preview Modal */}
      {previewOpen && lastPdf && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lastPdf.title}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
        >
          <div className="flex h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-[#2C2C2C] bg-[#121212] sm:h-[88vh] sm:rounded-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#242424] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-white">{lastPdf.title}</h3>
                <p className="font-mono-nums truncate text-xs text-[#8A8A8A]">{lastPdf.filename}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintPdf}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md border border-[#323232] bg-[#1A1A1A] px-3 py-1.5 text-xs font-medium text-white hover:border-[#C1121F] sm:min-h-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Print / Save PDF</span>
                  <span className="sm:hidden">Print</span>
                </button>
                <a
                  href={lastPdf.blobUrl}
                  download={lastPdf.filename}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-[#C1121F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#D91A28] sm:min-h-0"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Save PDF
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  aria-label="Close preview"
                  className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded p-1.5 text-[#9A9A9A] hover:bg-[#222222] hover:text-white sm:min-h-0 sm:min-w-0"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <iframe
              ref={previewFrameRef}
              src={lastPdf.blobUrl}
              title={lastPdf.title}
              className="h-full w-full flex-1 bg-white"
            />
            <div className="pb-safe border-t border-[#242424] bg-[#0B0B0B] px-4 py-2 text-[11px] text-[#8A8A8A] sm:px-5">
              If your browser preview blocks direct file downloads, click Print / Save PDF or open the app in a standalone tab.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
