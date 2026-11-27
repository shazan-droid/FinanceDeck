import { useMemo, useState, type FormEvent } from 'react';
import { Lock, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  HOLDING_KINDS,
  PRICE_SOURCES,
  type AppLanguage,
  type FinanceState,
  type HoldingEntry,
  type HoldingKind,
  type IndicatorEntry,
  type PriceSource,
} from '../types';
import {
  formatPricePerUnit,
  formatShillings,
  formatSignedShillings,
  todayIso,
} from '../utils/format';
import { getTranslations } from '../utils/i18n';
import { KpiStrip } from './KpiStrip';
import { Modal } from './Modal';

interface InvestmentsTabProps {
  state: FinanceState;
  language: AppLanguage;
  refreshingPrices: boolean;
  refreshingIndicators: boolean;
  priceStatusText: string;
  priceFailedDetails: Array<{ symbol: string; reason: string }>;
  onRefreshPrices: () => Promise<void>;
  onRefreshIndicators: () => Promise<void>;
  onRestoreStarter: () => Promise<void>;
  onSaveHolding: (
    payload: {
      symbol: string;
      kind: HoldingKind;
      units: number;
      cost: number;
      date: string;
      price: number;
      source: PriceSource;
      url: string;
      selector: string;
      regex: string;
    },
    id?: number
  ) => Promise<void>;
  onDeleteHolding: (id: number) => Promise<void>;
  onLookupQuote: (payload: {
    symbol: string;
    source: PriceSource;
    url: string;
    selector: string;
    regex: string;
  }) => Promise<{
    priceTzs: number;
    resolvedSymbol: string;
    nativePrice: number;
    nativeCurrency: string;
    fxRate: number;
    sourceLabel: string;
  }>;
  onSaveIndicator: (
    payload: { name: string; url: string; selector: string; regex: string },
    id?: number
  ) => Promise<void>;
  onDeleteIndicator: (id: number) => Promise<void>;
}

const SOURCE_LABELS: Record<PriceSource, string> = {
  DSE: 'DSE (Dar es Salaam Stock Exchange)',
  'UTT AMIS': 'UTT AMIS (Tanzania Unit Trusts)',
  Yahoo: 'Yahoo Finance (yfinance · Global Stocks & ETFs)',
  StockAnalysis: 'StockAnalysis (Global Stocks & ETFs Backup)',
  Fixed: 'Fixed (Locked Until Daily Public Updates)',
  'Investing.com': 'Legacy Investing.com (Routed via Yahoo/DSE)',
  Web: 'Web Scraper (Custom URL / CSS / Regex)',
  Manual: 'Manual Entry',
};

export function InvestmentsTab({
  state,
  language,
  refreshingPrices,
  refreshingIndicators,
  priceStatusText,
  priceFailedDetails,
  onRefreshPrices,
  onRefreshIndicators,
  onRestoreStarter,
  onSaveHolding,
  onDeleteHolding,
  onLookupQuote,
  onSaveIndicator,
  onDeleteIndicator,
}: InvestmentsTabProps) {
  const { holdings, indicators } = state;
  const currency = 'TZS';
  const t = getTranslations(language);

  const [kindFilter, setKindFilter] = useState<'All' | HoldingKind>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const inferSymbolAndSourceFromUrl = (
    rawUrl: string
  ): { inferredSymbol: string; inferredSource?: PriceSource } => {
    try {
      const normalized = /^https?:\/\//i.test(rawUrl.trim())
        ? rawUrl.trim()
        : `https://${rawUrl.trim()}`;
      const u = new URL(normalized);
      const host = u.hostname.toLowerCase();
      const segs = u.pathname.split('/').filter(Boolean);

      if (host.includes('finance.yahoo.com')) {
        const qIdx = segs.findIndex((s) => s.toLowerCase() === 'quote');
        const ticker = qIdx >= 0 && segs[qIdx + 1] ? decodeURIComponent(segs[qIdx + 1]).trim() : '';
        return { inferredSymbol: ticker, inferredSource: 'Yahoo' };
      }

      if (host.includes('stockanalysis.com')) {
        let ticker = '';
        if (segs[0] === 'quote' && segs[1] && segs[2]) {
          const ex = segs[1].toLowerCase();
          const t = segs[2].toUpperCase();
          ticker = ex === 'lon' ? `${t}.L` : ex === 'tsx' ? `${t}.TO` : ex === 'asx' ? `${t}.AX` : t;
        } else if ((segs[0] === 'stocks' || segs[0] === 'etf') && segs[1]) {
          ticker = segs[1].toUpperCase();
        }
        return { inferredSymbol: ticker, inferredSource: 'StockAnalysis' };
      }

      const slug = (segs[segs.length - 1] || '')
        .replace(/-historical-data$/i, '')
        .toLowerCase();
      if (!slug) return { inferredSymbol: '' };
      const dseSlugMap: Array<[RegExp, string]> = [
        [/\bcrdb\b/, 'CRDB'],
        [/\bnmb\b/, 'NMB'],
        [/\bvodacom\b|\bvoda\b/, 'VODA'],
        [/tanzania-?breweries|\btbl\b/, 'TBL'],
        [/portland-?cement|twiga|\btpcc\b/, 'TPCC'],
        [/tanga-?cement|\bsimba\b/, 'SIMBA'],
        [/swissport|\bswis\b/, 'SWIS'],
        [/precision-?air|\bpal\b/, 'PAL'],
        [/dar-?es-?salaam-?stock|\bdse\b/, 'DSE'],
        [/east-?african-?breweries|\beabl\b/, 'EABL'],
        [/kenya-?airways|\bka\b/, 'KA'],
        [/\bkcb\b/, 'KCB'],
        [/jubilee|\bjhl\b/, 'JHL'],
        [/nation-?media|\bnmg\b/, 'NMG'],
        [/\bdcb\b/, 'DCB'],
        [/maendeleo|\bmbp\b/, 'MBP'],
        [/mwalimu|\bmcb\b/, 'MCB'],
        [/mucoba/, 'MUCOBA'],
        [/yetu/, 'YETU'],
        [/tanzania-?cigarette|\btcc\b/, 'TCC'],
        [/\btol\b/, 'TOL'],
        [/tatepa|\bttp\b/, 'TTP'],
        [/afriprise/, 'AFRIPRISE'],
        [/nicol|\bnico\b/, 'NICO'],
        [/mkombozi|\bmkcb\b/, 'MKCB'],
      ];
      for (const [rx, ticker] of dseSlugMap) {
        if (rx.test(slug)) return { inferredSymbol: ticker, inferredSource: 'DSE' };
      }
      const readable = slug
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
      return {
        inferredSymbol: readable,
        inferredSource: host.includes('investing.com') ? 'Yahoo' : undefined,
      };
    } catch {
      return { inferredSymbol: '' };
    }
  };

  const portfolioSummary = useMemo(() => {
    let totalValue = 0;
    let totalCost = 0;
    for (const h of holdings) {
      if (h.units <= 0) continue;
      const px = h.price > 0 ? h.price : h.cost;
      totalValue += h.units * px;
      totalCost += h.units * h.cost;
    }
    const pl = totalValue - totalCost;
    const plPct = totalCost > 0 ? (pl / totalCost) * 100 : null;
    return { totalValue, totalCost, pl, plPct };
  }, [holdings]);

  const filteredHoldings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return holdings.filter((h) => {
      if (kindFilter !== 'All' && h.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        h.symbol.toLowerCase().includes(q) ||
        h.kind.toLowerCase().includes(q) ||
        h.source.toLowerCase().includes(q)
      );
    });
  }, [holdings, kindFilter, searchQuery]);

  const parseCleanNumber = (raw: string): number => {
    const cleaned = raw.replace(/,/g, '').trim();
    if (!cleaned) return 0;
    const n = Number(cleaned);
    return n;
  };

  // Holding Modal
  const [holdingModalOpen, setHoldingModalOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<HoldingEntry | null>(null);
  const [symbol, setSymbol] = useState('');
  const [kind, setKind] = useState<HoldingKind>('DSE Stock');
  const [units, setUnits] = useState('0');
  const [cost, setCost] = useState('0');
  const [totalInvestedInput, setTotalInvestedInput] = useState('0');
  const [date, setDate] = useState(todayIso());
  const [price, setPrice] = useState('0');
  const [source, setSource] = useState<PriceSource>('DSE');
  const [url, setUrl] = useState('');
  const [selector, setSelector] = useState('');
  const [regex, setRegex] = useState('');
  const [holdingError, setHoldingError] = useState('');
  const [quoteStatus, setQuoteStatus] = useState('');
  const [fetchingQuote, setFetchingQuote] = useState(false);
  const [savingHolding, setSavingHolding] = useState(false);

  const openAddHolding = () => {
    setEditingHolding(null);
    setSymbol('');
    setKind('DSE Stock');
    setUnits('0');
    setCost('0');
    setTotalInvestedInput('0');
    setDate(todayIso());
    setPrice('0');
    setSource('DSE');
    setUrl('');
    setSelector('');
    setRegex('');
    setHoldingError('');
    setQuoteStatus('');
    setFetchingQuote(false);
    setSavingHolding(false);
    setHoldingModalOpen(true);
  };

  const openEditHolding = (h: HoldingEntry) => {
    setEditingHolding(h);
    setSymbol(h.symbol);
    setKind(h.kind);
    setUnits(String(h.units));
    setCost(String(h.cost));
    setTotalInvestedInput(String(Math.round(h.units * h.cost * 100) / 100));
    setDate(h.date || todayIso());
    setPrice(String(h.price));
    const lowerUrl = (h.url || '').toLowerCase();
    let effectiveSource: PriceSource = h.source;
    if ((h.source === 'Web' || h.source === 'Investing.com') && lowerUrl) {
      if (lowerUrl.includes('stockanalysis.com')) effectiveSource = 'StockAnalysis';
      else if (lowerUrl.includes('investing.com') || lowerUrl.includes('finance.yahoo.com')) {
        effectiveSource = 'Yahoo';
      }
    }
    setSource(effectiveSource);
    setUrl(h.url || '');
    setSelector(h.selector || '');
    setRegex(h.regex || '');
    setHoldingError('');
    setQuoteStatus('');
    setFetchingQuote(false);
    setSavingHolding(false);
    setHoldingModalOpen(true);
  };

  const handleUnitsChange = (nextRaw: string) => {
    setUnits(nextRaw);
    const u = parseCleanNumber(nextRaw);
    const c = parseCleanNumber(cost);
    if (Number.isFinite(u) && u >= 0 && Number.isFinite(c) && c >= 0) {
      setTotalInvestedInput(String(Math.round(u * c * 100) / 100));
    }
  };

  const handleCostChange = (nextRaw: string) => {
    setCost(nextRaw);
    const u = parseCleanNumber(units);
    const c = parseCleanNumber(nextRaw);
    if (Number.isFinite(u) && u >= 0 && Number.isFinite(c) && c >= 0) {
      setTotalInvestedInput(String(Math.round(u * c * 100) / 100));
    }
  };

  const handleTotalInvestedChange = (nextRaw: string) => {
    setTotalInvestedInput(nextRaw);
    const inv = parseCleanNumber(nextRaw);
    if (!Number.isFinite(inv) || inv < 0) return;
    const u = parseCleanNumber(units);
    const c = parseCleanNumber(cost);
    const p = parseCleanNumber(price);
    if (u > 0) {
      setCost(String(Math.round((inv / u) * 10000) / 10000));
    } else if (c > 0) {
      setUnits(String(Math.round((inv / c) * 10000) / 10000));
    } else if (p > 0) {
      setCost(String(p));
      setUnits(String(Math.round((inv / p) * 10000) / 10000));
    }
  };

  const handleSymbolChange = (nextVal: string) => {
    const trimmed = nextVal.trim();
    if (
      /finance\.yahoo\.com|stockanalysis\.com|investing\.com/i.test(trimmed) ||
      /^https?:\/\//i.test(trimmed)
    ) {
      const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      setUrl(normalized);
      const { inferredSymbol, inferredSource } = inferSymbolAndSourceFromUrl(normalized);
      if (inferredSource) setSource(inferredSource);
      setSymbol(inferredSymbol || trimmed);
      return;
    }
    setSymbol(nextVal);
  };

  const handlePriceUrlChange = (nextUrl: string) => {
    setUrl(nextUrl);
    if (/finance\.yahoo\.com|stockanalysis\.com|investing\.com/i.test(nextUrl)) {
      const { inferredSymbol, inferredSource } = inferSymbolAndSourceFromUrl(nextUrl);
      if (!symbol.trim() && inferredSymbol) setSymbol(inferredSymbol);
      if (inferredSource && (source === 'DSE' || source === 'Investing.com')) {
        setSource(inferredSource);
      }
    }
  };

  const handleFetchQuote = async () => {
    setHoldingError('');
    setQuoteStatus('');
    const cleanSym = symbol.trim();
    const cleanUrl = url.trim();
    if (!cleanSym && !cleanUrl) {
      setHoldingError('Enter a ticker (e.g., AAPL, VUAA.L, CRDB) or quote URL first.');
      return;
    }
    setFetchingQuote(true);
    try {
      const q = await onLookupQuote({
        symbol: cleanSym,
        source,
        url: cleanUrl,
        selector: selector.trim(),
        regex: regex.trim(),
      });
      setPrice(String(q.priceTzs));
      const inv = parseCleanNumber(totalInvestedInput);
      const u = parseCleanNumber(units);
      if (inv > 0 && u === 0 && q.priceTzs > 0) {
        setCost(String(q.priceTzs));
        setUnits(String(Math.round((inv / q.priceTzs) * 10000) / 10000));
      }
      const fxNote =
        q.nativeCurrency !== 'TZS'
          ? ` (${q.nativeCurrency} ${q.nativePrice.toLocaleString('en-US', { maximumFractionDigits: 4 })} @ ${Math.round(q.fxRate).toLocaleString('en-US')} TZS/${q.nativeCurrency})`
          : '';
      setQuoteStatus(`${q.sourceLabel}: ${formatPricePerUnit(q.priceTzs, 'TZS')}${fxNote}`);
    } catch (err) {
      setHoldingError((err as Error).message || 'Could not fetch live quote.');
    } finally {
      setFetchingQuote(false);
    }
  };

  const submitHolding = async (e: FormEvent) => {
    e.preventDefault();
    setHoldingError('');

    let resolvedSymbol = symbol.trim();
    let normalizedUrl = url.trim();

    if (
      /^https?:\/\//i.test(resolvedSymbol) ||
      /finance\.yahoo\.com|stockanalysis\.com|investing\.com/i.test(resolvedSymbol)
    ) {
      const extractedUrl = /^https?:\/\//i.test(resolvedSymbol)
        ? resolvedSymbol
        : `https://${resolvedSymbol}`;
      if (!normalizedUrl) normalizedUrl = extractedUrl;
      const { inferredSymbol } = inferSymbolAndSourceFromUrl(extractedUrl);
      resolvedSymbol = inferredSymbol || resolvedSymbol;
    }

    if (!resolvedSymbol && normalizedUrl) {
      resolvedSymbol = inferSymbolAndSourceFromUrl(normalizedUrl).inferredSymbol;
    }

    if (!resolvedSymbol) {
      setHoldingError('Ticker or fund name is required.');
      return;
    }

    const u = parseCleanNumber(units);
    const c = parseCleanNumber(cost);
    const p = parseCleanNumber(price);
    const inv = parseCleanNumber(totalInvestedInput);
    if (!Number.isFinite(u) || u < 0 || !Number.isFinite(c) || c < 0 || !Number.isFinite(p) || p < 0) {
      setHoldingError('Units, cost, and price must be valid non-negative numbers.');
      return;
    }
    if (Number.isFinite(inv) && inv > 0 && u === 0 && c === 0) {
      setHoldingError(
        'Enter Units or Avg Cost per Unit (since Current Price is 0 TZS) so your invested amount can be saved.'
      );
      return;
    }

    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    setSavingHolding(true);
    try {
      await onSaveHolding(
        {
          symbol: resolvedSymbol,
          kind,
          units: u,
          cost: c,
          date: date || todayIso(),
          price: p,
          source,
          url: normalizedUrl,
          selector: selector.trim(),
          regex: regex.trim(),
        },
        editingHolding?.id
      );
      setHoldingModalOpen(false);
    } catch (err) {
      setHoldingError((err as Error).message || 'Failed to save holding. Please try again.');
    } finally {
      setSavingHolding(false);
    }
  };

  // Indicator Modal
  const [indModalOpen, setIndModalOpen] = useState(false);
  const [editingInd, setEditingInd] = useState<IndicatorEntry | null>(null);
  const [indName, setIndName] = useState('');
  const [indUrl, setIndUrl] = useState('');
  const [indSelector, setIndSelector] = useState('');
  const [indRegex, setIndRegex] = useState('');
  const [indError, setIndError] = useState('');
  const [savingInd, setSavingInd] = useState(false);

  const openAddIndicator = () => {
    setEditingInd(null);
    setIndName('');
    setIndUrl('');
    setIndSelector('');
    setIndRegex('');
    setIndError('');
    setSavingInd(false);
    setIndModalOpen(true);
  };

  const openEditIndicator = (ind: IndicatorEntry) => {
    setEditingInd(ind);
    setIndName(ind.name);
    setIndUrl(ind.url);
    setIndSelector(ind.selector || '');
    setIndRegex(ind.regex || '');
    setIndError('');
    setSavingInd(false);
    setIndModalOpen(true);
  };

  const submitIndicator = async (e: FormEvent) => {
    e.preventDefault();
    setIndError('');
    if (!indName.trim() || !indUrl.trim()) {
      setIndError('Indicator name and URL are required.');
      return;
    }
    let normalizedUrl = indUrl.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    setSavingInd(true);
    try {
      await onSaveIndicator(
        {
          name: indName.trim(),
          url: normalizedUrl,
          selector: indSelector.trim(),
          regex: indRegex.trim(),
        },
        editingInd?.id
      );
      setIndModalOpen(false);
    } catch (err) {
      setIndError((err as Error).message || 'Failed to save indicator. Please try again.');
    } finally {
      setSavingInd(false);
    }
  };

  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          {
            label: t.kpiPortfolioValue,
            value: formatShillings(portfolioSummary.totalValue, currency),
            sublabel: 'Market value in TZS',
          },
          {
            label: 'Cost basis',
            value: formatShillings(portfolioSummary.totalCost, currency),
            sublabel: 'Total invested capital',
          },
          {
            label: 'Unrealised P/L',
            value: formatSignedShillings(portfolioSummary.pl, currency),
            tone:
              portfolioSummary.pl > 0
                ? 'positive'
                : portfolioSummary.pl < 0
                  ? 'negative'
                  : 'default',
          },
          {
            label: 'P/L %',
            value:
              portfolioSummary.plPct !== null
                ? `${portfolioSummary.plPct >= 0 ? '+' : ''}${portfolioSummary.plPct.toFixed(2)}%`
                : 'n/a',
            tone:
              portfolioSummary.pl > 0
                ? 'positive'
                : portfolioSummary.pl < 0
                  ? 'negative'
                  : 'default',
          },
        ]}
      />

      {/* Holdings Table */}
      <section className="rounded-lg border border-[#242424] bg-[#121212]">
        <div className="flex flex-col gap-3.5 border-b border-[#222222] px-4 py-4 sm:px-5 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">{t.invTitleHoldings}</h2>
            <p className="mt-0.5 text-xs text-[#808080]">
              Prices in Tanzanian Shillings (TZS). Fixed rows stay locked until daily public updates are released.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:w-44">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#787878]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter ticker or fund..."
                className="h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] pr-3 pl-8 text-base text-white placeholder-[#686868] focus:border-[#C1121F] focus:outline-none sm:h-8 sm:text-xs"
              />
            </div>

            <div className="flex w-full items-center gap-0.5 overflow-x-auto rounded-md border border-[#2A2A2A] bg-[#0B0B0B] p-0.5 sm:w-auto">
              {(['All', ...HOLDING_KINDS] as Array<'All' | HoldingKind>).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`min-h-[36px] shrink-0 whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors sm:min-h-0 ${
                    kindFilter === k
                      ? 'bg-[#222222] text-white'
                      : 'text-[#8A8A8A] hover:text-white'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => void onRefreshPrices()}
                disabled={refreshingPrices}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-1.5 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white disabled:opacity-50 sm:min-h-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingPrices ? 'animate-spin' : ''}`} />
                {refreshingPrices ? t.updating : t.refreshPrices}
              </button>

              <button
                type="button"
                onClick={() => void onRestoreStarter()}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-1.5 text-xs font-medium text-[#CCCCCC] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0"
              >
                Restore Starter List
              </button>

              <button
                type="button"
                onClick={openAddHolding}
                className="col-span-2 inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#C1121F] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] sm:col-span-1 sm:min-h-0"
              >
                <Plus className="h-3.5 w-3.5" />
                {t.addHolding}
              </button>
            </div>
          </div>
        </div>

        {(priceStatusText || priceFailedDetails.length > 0) && (
          <div className="border-b border-[#202020] bg-[#0E0E0E] px-4 py-2.5 text-xs sm:px-5">
            {priceStatusText && <p className="text-[#CCCCCC]">{priceStatusText}</p>}
            {priceFailedDetails.length > 0 && (
              <p className="mt-1 text-amber-400">
                {priceFailedDetails.map((f) => `${f.symbol}: ${f.reason}`).join(' · ')}
              </p>
            )}
          </div>
        )}

        {filteredHoldings.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9A9A9A]">No holdings match your current filter.</p>
          </div>
        ) : (
          <>
            {/* Mobile stacked holdings */}
            <div className="divide-y divide-[#1E1E1E] md:hidden">
              {filteredHoldings.map((h) => {
                const effectivePrice = h.price > 0 ? h.price : h.cost;
                const marketValue = h.units * effectivePrice;
                const costBasis = h.units * h.cost;
                const pl = marketValue - costBasis;
                const plPct = costBasis > 0 ? (pl / costBasis) * 100 : null;

                return (
                  <div key={h.id} className="space-y-2 px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                          {h.source === 'Fixed' && (
                            <Lock className="h-3 w-3 shrink-0 text-[#888888]" />
                          )}
                          <span className="truncate">{h.symbol}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-[#8E8E8E]">
                          {h.kind} · {h.source}
                          {h.updated ? ` · ${h.updated}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono-nums text-sm font-semibold text-white">
                          {h.units > 0 ? formatShillings(marketValue, currency) : 'Watchlist'}
                        </p>
                        {h.units > 0 && (
                          <p
                            className={`font-mono-nums mt-0.5 text-xs font-medium ${
                              Math.abs(pl) < 0.01
                                ? 'text-[#8A8A8A]'
                                : pl > 0
                                  ? 'text-emerald-400'
                                  : 'text-red-400'
                            }`}
                          >
                            {formatSignedShillings(pl, currency, 0)}
                            {plPct !== null ? ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%)` : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="font-mono-nums text-[11px] text-[#9A9A9A]">
                        <span>
                          {h.units.toLocaleString('en-US', { maximumFractionDigits: 4 })} units
                        </span>
                        <span> · </span>
                        <span>
                          Px {h.price > 0 ? formatPricePerUnit(h.price, currency) : 'Pending'}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditHolding(h)}
                          aria-label={`Edit ${h.symbol}`}
                          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteHolding(h.id)}
                          aria-label={`Delete ${h.symbol}`}
                          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:bg-[#2A0A0D] hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop holdings table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#C1121F]/70 bg-[#0E0E0E] text-xs font-semibold text-[#9A9A9A]">
                    <th className="px-4 py-3">Ticker / Name</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Units</th>
                    <th className="px-4 py-3 text-right">Avg cost ({currency})</th>
                    <th className="px-4 py-3 text-right">Price / NAV ({currency})</th>
                    <th className="px-4 py-3 text-right">Value ({currency})</th>
                    <th className="px-4 py-3 text-right">P/L</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E1E]">
                  {filteredHoldings.map((h) => {
                    const effectivePrice = h.price > 0 ? h.price : h.cost;
                    const marketValue = h.units * effectivePrice;
                    const costBasis = h.units * h.cost;
                    const pl = marketValue - costBasis;
                    const plPct = costBasis > 0 ? (pl / costBasis) * 100 : null;

                    return (
                      <tr key={h.id} className="transition-colors hover:bg-[#171717]">
                        <td className="px-4 py-3 font-medium text-white">{h.symbol}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[#A0A0A0]">
                          {h.kind}
                        </td>
                        <td className="font-mono-nums whitespace-nowrap px-4 py-3 text-right text-[#D4D4D4]">
                          {h.units.toLocaleString('en-US', { maximumFractionDigits: 4 })}
                        </td>
                        <td className="font-mono-nums whitespace-nowrap px-4 py-3 text-right text-[#B5B5B5]">
                          {h.cost > 0 ? formatPricePerUnit(h.cost, currency) : '-'}
                        </td>
                        <td className="font-mono-nums whitespace-nowrap px-4 py-3 text-right">
                          {h.price > 0 ? (
                            <span className="font-medium text-white">
                              {formatPricePerUnit(h.price, currency)}
                            </span>
                          ) : (
                            <span className="text-[#8A8A8A]">Pending</span>
                          )}
                        </td>
                        <td className="font-mono-nums whitespace-nowrap px-4 py-3 text-right font-medium text-white">
                          {h.units > 0 ? formatShillings(marketValue, currency) : 'Watchlist'}
                        </td>
                        <td
                          className={`font-mono-nums whitespace-nowrap px-4 py-3 text-right text-xs font-medium ${
                            h.units <= 0 || Math.abs(pl) < 0.01
                              ? 'text-[#8A8A8A]'
                              : pl > 0
                                ? 'text-emerald-400'
                                : 'text-red-400'
                          }`}
                        >
                          {h.units > 0
                            ? `${formatSignedShillings(pl, currency, 0)}${
                                plPct !== null ? ` (${plPct >= 0 ? '+' : ''}${plPct.toFixed(1)}%)` : ''
                              }`
                            : '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[#B5B5B5]">
                          <span className="inline-flex items-center gap-1.5">
                            {h.source === 'Fixed' && <Lock className="h-3 w-3 text-[#888888]" />}
                            {h.source}
                          </span>
                        </td>
                        <td className="font-mono-nums whitespace-nowrap px-4 py-3 text-xs text-[#8A8A8A]">
                          {h.updated || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEditHolding(h)}
                              aria-label={`Edit ${h.symbol}`}
                              className="rounded p-1.5 text-[#8A8A8A] transition-colors hover:bg-[#222222] hover:text-white"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDeleteHolding(h.id)}
                              aria-label={`Delete ${h.symbol}`}
                              className="rounded p-1.5 text-[#8A8A8A] transition-colors hover:bg-[#2A0A0D] hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Market Indicators */}
      <section className="rounded-lg border border-[#242424] bg-[#121212]">
        <div className="flex flex-col gap-3 border-b border-[#222222] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-white">{t.invTitleIndicators}</h2>
            <p className="mt-0.5 text-xs text-[#808080]">
              Live UTT AMIS fund NAVs and Dar es Salaam Stock Exchange benchmarks in TZS.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2.5">
            <button
              type="button"
              onClick={() => void onRefreshIndicators()}
              disabled={refreshingIndicators}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-1.5 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingIndicators ? 'animate-spin' : ''}`} />
              {refreshingIndicators ? 'Updating...' : 'Refresh Indicators'}
            </button>
            <button
              type="button"
              onClick={openAddIndicator}
              className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#C1121F] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] sm:min-h-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Indicator
            </button>
          </div>
        </div>

        {indicators.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-[#9A9A9A]">No market indicators configured.</p>
          </div>
        ) : (
          <>
            {/* Mobile indicator list */}
            <div className="divide-y divide-[#1E1E1E] md:hidden">
              {indicators.map((ind) => (
                <div key={ind.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{ind.name}</p>
                    <p className="mt-0.5 truncate text-xs text-[#8A8A8A]">{ind.url}</p>
                    <p className="font-mono-nums mt-0.5 text-[11px] text-[#737373]">
                      Updated {ind.updated || '-'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-mono-nums text-sm font-semibold text-white">
                      {ind.value || '-'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditIndicator(ind)}
                        aria-label={`Edit ${ind.name}`}
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteIndicator(ind.id)}
                        aria-label={`Delete ${ind.name}`}
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:bg-[#2A0A0D] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop indicator table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#C1121F]/70 bg-[#0E0E0E] text-xs font-semibold text-[#9A9A9A]">
                    <th className="px-4 py-3">Indicator name</th>
                    <th className="px-4 py-3">Source URL</th>
                    <th className="px-4 py-3 text-right">Latest value</th>
                    <th className="px-4 py-3">Updated</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E1E]">
                  {indicators.map((ind) => (
                    <tr key={ind.id} className="transition-colors hover:bg-[#171717]">
                      <td className="px-4 py-2.5 font-medium text-white">{ind.name}</td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-xs text-[#8A8A8A]">
                        {ind.url}
                      </td>
                      <td className="font-mono-nums whitespace-nowrap px-4 py-2.5 text-right font-medium text-white">
                        {ind.value || '-'}
                      </td>
                      <td className="font-mono-nums whitespace-nowrap px-4 py-2.5 text-xs text-[#8A8A8A]">
                        {ind.updated || '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditIndicator(ind)}
                            aria-label={`Edit ${ind.name}`}
                            className="rounded p-1.5 text-[#8A8A8A] transition-colors hover:bg-[#222222] hover:text-white"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteIndicator(ind.id)}
                            aria-label={`Delete ${ind.name}`}
                            className="rounded p-1.5 text-[#8A8A8A] transition-colors hover:bg-[#2A0A0D] hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Holding Modal */}
      <Modal
        open={holdingModalOpen}
        title={editingHolding ? `Edit ${editingHolding.symbol}` : 'Add Holding'}
        size="lg"
        onClose={() => setHoldingModalOpen(false)}
      >
        <form onSubmit={(e) => void submitHolding(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Ticker / Fund Name</span>
              <input
                type="text"
                list="tz-symbol-presets"
                value={symbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                placeholder="e.g., AAPL, VUAA.L, CRDB, UTT AMIS Liquid Fund, or quote URL"
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
              <datalist id="tz-symbol-presets">
                <option value="CRDB" />
                <option value="NMB" />
                <option value="VODA" />
                <option value="DSE" />
                <option value="TBL" />
                <option value="TPCC" />
                <option value="PAL" />
                <option value="DCB" />
                <option value="AFRIPRISE" />
                <option value="IEACLC-ETF" />
                <option value="VERTEX-ETF" />
                <option value="ZAN TIMIZA ETF" />
                <option value="TCCL" />
                <option value="SWIS" />
                <option value="NICO" />
                <option value="UTT AMIS Liquid Fund" />
                <option value="UTT AMIS Umoja Fund" />
                <option value="UTT AMIS Bond Fund" />
                <option value="UTT AMIS Watoto Fund" />
                <option value="UTT AMIS Jikimu Fund" />
                <option value="UTT AMIS Wekeza Maisha Fund" />
                <option value="AAPL" />
                <option value="MSFT" />
                <option value="NVDA" />
                <option value="VOO" />
                <option value="VUAA.L" />
                <option value="VWRA.L" />
                <option value="BTC-USD" />
              </datalist>
            </label>

            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Type</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as HoldingKind)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                {HOLDING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Units</span>
              <input
                type="text"
                inputMode="decimal"
                value={units}
                onChange={(e) => handleUnitsChange(e.target.value)}
                placeholder="e.g., 1000"
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Avg Cost per Unit (TZS)</span>
              <input
                type="text"
                inputMode="decimal"
                value={cost}
                onChange={(e) => handleCostChange(e.target.value)}
                placeholder="e.g., 295"
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Total Invested (TZS)</span>
              <input
                type="text"
                inputMode="decimal"
                value={totalInvestedInput}
                onChange={(e) => handleTotalInvestedChange(e.target.value)}
                placeholder="Auto-calculates units or cost"
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Current Price / NAV (TZS)</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={
                    source !== 'Fixed' && source !== 'Manual'
                      ? '0 = auto-fetch live price'
                      : 'e.g., 295'
                  }
                  className="font-mono-nums h-10 min-w-0 flex-1 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
                />
                {source !== 'Fixed' && source !== 'Manual' && (
                  <button
                    type="button"
                    onClick={() => void handleFetchQuote()}
                    disabled={fetchingQuote}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#323232] bg-[#181818] px-3 text-xs font-medium text-white transition-colors hover:border-[#C1121F] disabled:opacity-50 sm:h-9"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${fetchingQuote ? 'animate-spin' : ''}`} />
                    {fetchingQuote ? 'Fetching...' : 'Fetch Quote'}
                  </button>
                )}
              </div>
            </label>
          </div>

          {quoteStatus && (
            <p role="status" className="text-xs text-emerald-400">
              {quoteStatus}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Price Source</span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as PriceSource)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                {(source === 'Investing.com'
                  ? (['Investing.com', ...PRICE_SOURCES] as PriceSource[])
                  : PRICE_SOURCES
                ).map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s] || s}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Date Bought</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
          </div>

          {(source === 'Yahoo' ||
            source === 'StockAnalysis' ||
            source === 'Web' ||
            source === 'Investing.com') && (
            <div className="space-y-3 rounded-md border border-[#242424] bg-[#0B0B0B] p-3">
              <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
                <span>
                  {source === 'Yahoo'
                    ? 'Yahoo Finance Quote URL (optional if ticker is entered)'
                    : source === 'StockAnalysis'
                      ? 'StockAnalysis Quote URL (optional if ticker is entered)'
                      : 'Price Page URL'}
                </span>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => handlePriceUrlChange(e.target.value)}
                  placeholder={
                    source === 'Yahoo'
                      ? 'https://finance.yahoo.com/quote/AAPL (or leave blank & enter AAPL / VUAA.L)'
                      : source === 'StockAnalysis'
                        ? 'https://stockanalysis.com/stocks/aapl/ (or leave blank & enter AAPL)'
                        : 'https://...'
                  }
                  className="h-10 rounded-md border border-[#2A2A2A] bg-[#121212] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
                />
              </label>
              {(source === 'Yahoo' || source === 'StockAnalysis' || source === 'Investing.com') && (
                <p className="text-[11px] leading-relaxed text-[#8A8A8A]">
                  Powered by Yahoo Finance (yfinance API) with StockAnalysis fallback — supports US stocks (AAPL, NVDA), London ETFs (VUAA.L, VWRA.L), crypto (BTC-USD), and auto-converts foreign currencies (USD, GBP/GBp, EUR) to TZS.
                </p>
              )}
              {source === 'Web' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
                    <span>CSS Selector (optional)</span>
                    <input
                      type="text"
                      value={selector}
                      onChange={(e) => setSelector(e.target.value)}
                      className="h-10 rounded-md border border-[#2A2A2A] bg-[#121212] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
                    <span>Regex (group 1 wins)</span>
                    <input
                      type="text"
                      value={regex}
                      onChange={(e) => setRegex(e.target.value)}
                      className="h-10 rounded-md border border-[#2A2A2A] bg-[#121212] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {holdingError && <p role="alert" className="text-xs text-red-400">{holdingError}</p>}

          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setHoldingModalOpen(false)}
              disabled={savingHolding}
              className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingHolding}
              className="min-h-[44px] rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
            >
              {savingHolding ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Indicator Modal */}
      <Modal
        open={indModalOpen}
        title={editingInd ? 'Edit Market Indicator' : 'Add Market Indicator'}
        onClose={() => setIndModalOpen(false)}
      >
        <form onSubmit={(e) => void submitIndicator(e)} className="space-y-4">
          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>Indicator Name</span>
            <input
              type="text"
              value={indName}
              onChange={(e) => setIndName(e.target.value)}
              placeholder="e.g., UTT AMIS Watoto Fund (NAV)"
              className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>URL</span>
            <input
              type="text"
              value={indUrl}
              onChange={(e) => setIndUrl(e.target.value)}
              placeholder="https://uttamis.co.tz/..."
              className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
            />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>CSS Selector (optional)</span>
              <input
                type="text"
                value={indSelector}
                onChange={(e) => setIndSelector(e.target.value)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Regex (optional, group 1)</span>
              <input
                type="text"
                value={indRegex}
                onChange={(e) => setIndRegex(e.target.value)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
          </div>
          {indError && <p role="alert" className="text-xs text-red-400">{indError}</p>}
          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setIndModalOpen(false)}
              disabled={savingInd}
              className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingInd}
              className="min-h-[44px] rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
            >
              {savingInd ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
