import { useMemo, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckSquare,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  BALANCE_TYPES,
  BANK_OPTIONS,
  HOLDING_KINDS,
  TRANSACTION_CATEGORIES,
  type BalanceType,
  type HoldingKind,
  type ParsedStatementItem,
  type ParsedStatementResult,
  type StatementTargetSection,
  type TransactionActivity,
} from '../types';
import { formatShillings, todayIso } from '../utils/format';

interface BankStatementImportModalProps {
  open: boolean;
  onClose: () => void;
  onParseStatement: (payload: {
    filename: string;
    mimeType: string;
    dataBase64?: string;
    textContent?: string;
    bankNameHint?: string;
  }) => Promise<ParsedStatementResult>;
  onImportStatement: (payload: {
    items: ParsedStatementItem[];
    closingBalanceUpdate?: { bankName: string; amount: number; date: string } | null;
  }) => Promise<{
    imported: { transactions: number; balance: number; holdings: number };
  }>;
}

const SECTION_LABELS: Array<{ value: StatementTargetSection; label: string }> = [
  { value: 'cashflow', label: 'Cash Flow Ledger' },
  { value: 'current_asset', label: 'Current Asset' },
  { value: 'current_liability', label: 'Current Liability' },
  { value: 'longterm_asset', label: 'Long-Term Asset' },
  { value: 'longterm_liability', label: 'Long-Term Liability' },
  { value: 'holding', label: 'Investment Holding' },
];

export function BankStatementImportModal({
  open,
  onClose,
  onParseStatement,
  onImportStatement,
}: BankStatementImportModalProps) {
  const [bankHint, setBankHint] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState<string>('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  const [parsedResult, setParsedResult] = useState<ParsedStatementResult | null>(null);
  const [items, setItems] = useState<ParsedStatementItem[]>([]);
  const [syncClosingBalance, setSyncClosingBalance] = useState(true);
  const [closingBankName, setClosingBankName] = useState<string>(BANK_OPTIONS[0]);
  const [closingAmount, setClosingAmount] = useState<string>('');
  const [closingDate, setClosingDate] = useState<string>(todayIso());

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importSuccess, setImportSuccess] = useState('');

  const resetAll = () => {
    setSelectedFile(null);
    setPastedText('');
    setParseError('');
    setParsedResult(null);
    setItems([]);
    setSyncClosingBalance(true);
    setClosingBankName(BANK_OPTIONS[0]);
    setClosingAmount('');
    setClosingDate(todayIso());
    setImportError('');
    setImportSuccess('');
    setParsing(false);
    setImporting(false);
  };

  const handleClose = () => {
    if (parsing || importing) return;
    resetAll();
    onClose();
  };

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setParseError('Statement file must be 6 MB or smaller.');
      return;
    }
    setParseError('');
    setSelectedFile(file);
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });

  const handleAnalyze = async () => {
    setParseError('');
    setImportError('');
    setImportSuccess('');

    if (!selectedFile && !pastedText.trim()) {
      setParseError('Upload a statement file (PDF, CSV, TXT, PNG, JPG, WEBP) or paste statement text.');
      return;
    }

    setParsing(true);
    try {
      let payload: {
        filename: string;
        mimeType: string;
        dataBase64?: string;
        textContent?: string;
        bankNameHint?: string;
      };

      if (selectedFile) {
        const isText =
          selectedFile.type === 'text/csv' ||
          selectedFile.type === 'text/plain' ||
          /\.(csv|txt|tsv)$/i.test(selectedFile.name);
        if (isText) {
          const textContent = await selectedFile.text();
          payload = {
            filename: selectedFile.name,
            mimeType: selectedFile.type || 'text/csv',
            textContent,
            bankNameHint: bankHint || undefined,
          };
        } else {
          const dataBase64 = await readFileAsDataUrl(selectedFile);
          payload = {
            filename: selectedFile.name,
            mimeType: selectedFile.type || 'application/pdf',
            dataBase64,
            bankNameHint: bankHint || undefined,
          };
        }
      } else {
        payload = {
          filename: 'pasted-statement.txt',
          mimeType: 'text/plain',
          textContent: pastedText.trim(),
          bankNameHint: bankHint || undefined,
        };
      }

      const result = await onParseStatement(payload);
      setParsedResult(result);
      setItems(result.items);

      const matchedBank =
        BANK_OPTIONS.find((b) =>
          (result.bankDetected || bankHint || '').toLowerCase().includes(b.toLowerCase())
        ) ||
        bankHint ||
        result.bankDetected ||
        BANK_OPTIONS[0];
      setClosingBankName(matchedBank);

      if (result.closingBalance && result.closingBalance.amount > 0) {
        setSyncClosingBalance(true);
        setClosingAmount(String(result.closingBalance.amount));
        setClosingDate(result.closingBalance.date || todayIso());
      } else {
        setSyncClosingBalance(false);
        setClosingAmount('');
        setClosingDate(result.statementTo || todayIso());
      }
    } catch (err) {
      setParseError((err as Error).message || 'Failed to analyze bank statement.');
    } finally {
      setParsing(false);
    }
  };

  const updateItem = (id: string, patch: Partial<ParsedStatementItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const selectedSummary = useMemo(() => {
    let cashflow = 0;
    let balance = 0;
    let holdings = 0;
    let inflows = 0;
    let outflows = 0;
    for (const it of items) {
      if (!it.include) continue;
      if (it.targetSection === 'cashflow') {
        cashflow += 1;
        const abs = Math.abs(Number(it.amount) || 0);
        if (it.direction === 'income') inflows += abs;
        else outflows += abs;
      } else if (it.targetSection === 'holding') {
        holdings += 1;
      } else {
        balance += 1;
      }
    }
    return {
      total: cashflow + balance + holdings,
      cashflow,
      balance,
      holdings,
      inflows,
      outflows,
    };
  }, [items]);

  const handleConfirmImport = async () => {
    setImportError('');
    setImportSuccess('');

    const includedItems = items
      .filter((it) => it.include && Math.abs(Number(it.amount) || 0) > 0)
      .map((it) => ({
        ...it,
        amount:
          it.targetSection === 'cashflow'
            ? it.direction === 'expense'
              ? -Math.abs(Number(it.amount) || 0)
              : Math.abs(Number(it.amount) || 0)
            : Math.abs(Number(it.amount) || 0),
      }));

    const parsedClosing = Number(String(closingAmount).replace(/,/g, '').trim());
    const closingUpdate =
      syncClosingBalance &&
      closingBankName.trim() &&
      Number.isFinite(parsedClosing) &&
      parsedClosing >= 0 &&
      closingAmount.trim() !== ''
        ? {
            bankName: closingBankName.trim(),
            amount: parsedClosing,
            date: closingDate || todayIso(),
          }
        : null;

    if (includedItems.length === 0 && !closingUpdate) {
      setImportError('Select at least one row or enable closing bank balance sync to import.');
      return;
    }

    setImporting(true);
    try {
      const res = await onImportStatement({
        items: includedItems,
        closingBalanceUpdate: closingUpdate,
      });
      const parts: string[] = [];
      if (res.imported.transactions > 0) parts.push(`${res.imported.transactions} cash flow`);
      if (res.imported.balance > 0) parts.push(`${res.imported.balance} balance`);
      if (res.imported.holdings > 0) parts.push(`${res.imported.holdings} holdings`);
      setImportSuccess(`Imported ${parts.join(', ') || 'statement updates'} into FinanceDesk.`);
      window.setTimeout(() => {
        resetAll();
        onClose();
      }, 900);
    } catch (err) {
      setImportError((err as Error).message || 'Failed to import sorted entries.');
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import & Sort Bank Statement (AI)"
    >
      <div className="flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl border border-[#2C2C2C] bg-[#121212] shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-lg">
        <div className="flex items-center justify-between gap-3 border-b border-[#222222] px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Sparkles className="h-4 w-4 shrink-0 text-[#C1121F]" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold text-white">
                AI Bank Statement Import &amp; Auto-Sort
              </h3>
              <p className="text-xs text-[#8A8A8A]">
                Upload a bank, mobile money, or brokerage statement to extract and sort entries into FinanceDesk (TZS).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={parsing || importing}
            aria-label="Close statement import modal"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded p-1.5 text-[#8A8A8A] transition-colors hover:bg-[#222222] hover:text-white disabled:opacity-50 sm:min-h-0 sm:min-w-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="pb-safe flex-1 overflow-y-auto p-4 sm:p-5">
          {!parsedResult ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs text-[#A0A0A0]">
                  <span>Bank / Mobile Money Hint (optional)</span>
                  <select
                    value={bankHint}
                    onChange={(e) => setBankHint(e.target.value)}
                    className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
                  >
                    <option value="">Auto-detect from statement</option>
                    {BANK_OPTIONS.map((bank) => (
                      <option key={bank} value={bank}>
                        {bank}
                      </option>
                    ))}
                    <option value="CRDB / NMB / M-Pesa / Broker">Other Bank / Mobile / Broker</option>
                  </select>
                </label>

                <div className="flex flex-col gap-1.5 text-xs text-[#A0A0A0]">
                  <span>Supported Formats</span>
                  <div className="flex min-h-[40px] items-center rounded-md border border-[#242424] bg-[#0B0B0B] px-3 text-xs text-[#B0B0B0] sm:h-9 sm:min-h-0">
                    PDF, CSV, TXT, PNG, JPG, WEBP · Max 6 MB
                  </div>
                </div>
              </div>

              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#343434] bg-[#0B0B0B] px-4 py-6 text-center transition-colors hover:border-[#C1121F] sm:px-6 sm:py-7">
                <Upload className="h-6 w-6 text-[#C1121F]" />
                {selectedFile ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white break-all">{selectedFile.name}</p>
                    <p className="font-mono-nums text-xs text-[#8A8A8A]">
                      {(selectedFile.size / 1024).toFixed(1)} KB · Tap to replace file
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white">
                      Tap to upload bank statement PDF, CSV, or screenshot
                    </p>
                    <p className="text-xs text-[#7E7E7E]">
                      Selcom, Stanbic, Tigo Pesa / Mixx, CRDB, NMB, DSE / UTT statements supported
                    </p>
                  </div>
                )}
                <input
                  type="file"
                  accept=".pdf,.csv,.txt,.tsv,image/png,image/jpeg,image/webp"
                  onChange={handleFilePick}
                  className="hidden"
                />
              </label>

              {selectedFile && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="text-xs text-[#9A9A9A] hover:text-red-400"
                  >
                    Clear selected file
                  </button>
                </div>
              )}

              <label className="flex flex-col gap-1.5 text-xs text-[#A0A0A0]">
                <span>Or paste statement CSV / SMS / text lines directly</span>
                <textarea
                  rows={5}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder={`Example:\n2025-05-01 | LUKU Token Purchase | -30,000 TZS\n2025-05-02 | Salary Deposit Stanbic | +2,500,000 TZS\n2025-05-04 | Selcom Food & Groceries | -100,000 TZS`}
                  className="font-mono-nums rounded-md border border-[#2A2A2A] bg-[#0B0B0B] p-3 text-base leading-relaxed text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none sm:text-xs"
                />
              </label>

              {parseError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-red-900/60 bg-[#1F0B0D] px-4 py-3 text-xs text-red-300"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <span>{parseError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5 pt-1 sm:flex sm:items-center sm:justify-end sm:gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={parsing}
                  className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleAnalyze()}
                  disabled={parsing}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
                >
                  {parsing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      Analyze with AI
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Summary & Closing Balance Sync */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-md border border-[#242424] bg-[#0B0B0B] p-4 lg:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-[#C1121F]" />
                      <span className="text-sm font-semibold text-white">
                        {parsedResult.bankDetected}
                      </span>
                      {(parsedResult.statementFrom || parsedResult.statementTo) && (
                        <span className="font-mono-nums text-xs text-[#8A8A8A]">
                          ({parsedResult.statementFrom || '?'} → {parsedResult.statementTo || '?'})
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setParsedResult(null);
                        setImportError('');
                      }}
                      className="inline-flex items-center gap-1 text-xs text-[#B0B0B0] hover:text-white"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Upload another file
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#CCCCCC]">
                    {parsedResult.summary}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#9A9A9A]">
                    <span>
                      Selected: <strong className="text-white">{selectedSummary.total}</strong> rows
                    </span>
                    <span>
                      Inflows:{' '}
                      <strong className="font-mono-nums text-emerald-400">
                        {formatShillings(selectedSummary.inflows, 'TZS', 0)}
                      </strong>
                    </span>
                    <span>
                      Outflows:{' '}
                      <strong className="font-mono-nums text-red-400">
                        {formatShillings(selectedSummary.outflows, 'TZS', 0)}
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="rounded-md border border-[#242424] bg-[#0B0B0B] p-4">
                  <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-xs font-medium text-white sm:min-h-0">
                    <input
                      type="checkbox"
                      checked={syncClosingBalance}
                      onChange={(e) => setSyncClosingBalance(e.target.checked)}
                      className="h-4 w-4 accent-[#C1121F]"
                    />
                    <span>Update Cash in Bank balance</span>
                  </label>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={closingBankName}
                      disabled={!syncClosingBalance}
                      onChange={(e) => setClosingBankName(e.target.value)}
                      className="h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2 text-base text-white focus:border-[#C1121F] focus:outline-none disabled:opacity-40 sm:h-8 sm:text-xs"
                    >
                      {!BANK_OPTIONS.includes(closingBankName as (typeof BANK_OPTIONS)[number]) &&
                        closingBankName && <option value={closingBankName}>{closingBankName}</option>}
                      {BANK_OPTIONS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={closingDate}
                      disabled={!syncClosingBalance}
                      onChange={(e) => setClosingDate(e.target.value)}
                      className="font-mono-nums h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2 text-base text-white focus:border-[#C1121F] focus:outline-none disabled:opacity-40 sm:h-8 sm:text-xs"
                    />
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={closingAmount}
                    disabled={!syncClosingBalance}
                    onChange={(e) => setClosingAmount(e.target.value)}
                    placeholder="Closing balance (TZS)"
                    className="font-mono-nums mt-2 h-10 w-full rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white focus:border-[#C1121F] focus:outline-none disabled:opacity-40 sm:h-8 sm:text-xs"
                  />
                </div>
              </div>

              {/* Bulk Selection Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.map((it) => ({ ...it, include: true })))}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded border border-[#2C2C2C] px-2.5 py-1.5 text-xs text-[#CCCCCC] hover:border-[#C1121F] hover:text-white sm:min-h-0"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.map((it) => ({ ...it, include: false })))}
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded border border-[#2C2C2C] px-2.5 py-1.5 text-xs text-[#CCCCCC] hover:border-[#C1121F] hover:text-white sm:min-h-0"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Deselect All
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setItems((prev) =>
                        prev.map((it) => ({ ...it, include: !it.possibleDuplicate }))
                      )
                    }
                    className="inline-flex min-h-[38px] items-center gap-1.5 rounded border border-[#2C2C2C] px-2.5 py-1.5 text-xs text-[#CCCCCC] hover:border-[#C1121F] hover:text-white sm:min-h-0"
                  >
                    Skip Possible Duplicates
                  </button>
                </div>
                <span className="text-xs text-[#8A8A8A]">
                  Edit any section, category, or amount before importing.
                </span>
              </div>

              {items.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#2A2A2A] px-6 py-10 text-center text-sm text-[#9A9A9A]">
                  No individual line items were detected. You can still sync the closing bank balance above or upload a different statement.
                </div>
              ) : (
                <>
                  {/* Mobile Stacked Review Cards */}
                  <div className="space-y-3 md:hidden">
                    {items.map((row) => (
                      <div
                        key={row.id}
                        className={`space-y-2.5 rounded-md border border-[#242424] bg-[#0B0B0B] p-3.5 ${
                          row.include ? '' : 'opacity-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-white">
                            <input
                              type="checkbox"
                              checked={row.include}
                              onChange={(e) => updateItem(row.id, { include: e.target.checked })}
                              className="h-4 w-4 accent-[#C1121F]"
                            />
                            <span>Include</span>
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) => updateItem(row.id, { date: e.target.value })}
                              className="font-mono-nums h-9 rounded border border-[#2A2A2A] bg-[#121212] px-2 text-base text-white focus:border-[#C1121F] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(row.id)}
                              aria-label="Remove row"
                              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#2A2A2A] text-[#8A8A8A] hover:border-red-900 hover:text-red-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {row.possibleDuplicate && (
                          <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            <span>Possible duplicate entry detected</span>
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <select
                            value={row.targetSection}
                            onChange={(e) =>
                              updateItem(row.id, {
                                targetSection: e.target.value as StatementTargetSection,
                              })
                            }
                            className="h-10 w-full rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white focus:border-[#C1121F] focus:outline-none"
                          >
                            {SECTION_LABELS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          {row.targetSection === 'cashflow' ? (
                            <div className="grid grid-cols-2 gap-2">
                              <select
                                value={row.activity}
                                onChange={(e) =>
                                  updateItem(row.id, {
                                    activity: e.target.value as TransactionActivity,
                                  })
                                }
                                className="h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2 text-base capitalize text-white focus:border-[#C1121F] focus:outline-none"
                              >
                                <option value="operating">operating</option>
                                <option value="investing">investing</option>
                                <option value="financing">financing</option>
                              </select>
                              <select
                                value={row.direction}
                                onChange={(e) =>
                                  updateItem(row.id, {
                                    direction: e.target.value as 'income' | 'expense',
                                  })
                                }
                                className={`h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2 text-base font-medium focus:border-[#C1121F] focus:outline-none ${
                                  row.direction === 'income' ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                <option value="expense">Expense (-)</option>
                                <option value="income">Income (+)</option>
                              </select>
                            </div>
                          ) : row.targetSection === 'holding' ? (
                            <input
                              type="text"
                              value={row.holdingSymbol || ''}
                              onChange={(e) =>
                                updateItem(row.id, { holdingSymbol: e.target.value })
                              }
                              placeholder="Symbol"
                              className="h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white focus:border-[#C1121F] focus:outline-none"
                            />
                          ) : (
                            <select
                              value={row.balanceType}
                              onChange={(e) =>
                                updateItem(row.id, {
                                  balanceType: e.target.value as BalanceType,
                                })
                              }
                              className="h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white focus:border-[#C1121F] focus:outline-none"
                            >
                              {BALANCE_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {t}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>

                        {row.targetSection === 'cashflow' ? (
                          <select
                            value={row.category}
                            onChange={(e) => updateItem(row.id, { category: e.target.value })}
                            className="h-10 w-full rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white focus:border-[#C1121F] focus:outline-none"
                          >
                            {!TRANSACTION_CATEGORIES.includes(
                              row.category as (typeof TRANSACTION_CATEGORIES)[number]
                            ) && <option value={row.category}>{row.category}</option>}
                            {TRANSACTION_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        ) : row.targetSection === 'holding' ? (
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              value={row.holdingKind || 'Stock'}
                              onChange={(e) =>
                                updateItem(row.id, {
                                  holdingKind: e.target.value as HoldingKind,
                                })
                              }
                              className="h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white focus:border-[#C1121F] focus:outline-none"
                            >
                              {HOLDING_KINDS.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.holdingUnits ?? 1}
                              onChange={(e) =>
                                updateItem(row.id, { holdingUnits: Number(e.target.value) || 0 })
                              }
                              placeholder="Units"
                              className="font-mono-nums h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white"
                            />
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <input
                            type="text"
                            value={row.description}
                            onChange={(e) => updateItem(row.id, { description: e.target.value })}
                            placeholder="Description"
                            className="h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-base text-white focus:border-[#C1121F] focus:outline-none sm:col-span-2"
                          />
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={Math.abs(Number(row.amount) || 0)}
                            onChange={(e) =>
                              updateItem(row.id, {
                                amount: Math.abs(Number(e.target.value) || 0),
                              })
                            }
                            placeholder="Amount TZS"
                            className="font-mono-nums h-10 rounded border border-[#2A2A2A] bg-[#121212] px-2.5 text-right text-base text-white focus:border-[#C1121F] focus:outline-none"
                          />
                        </div>

                        {row.originalDescription &&
                          row.originalDescription.trim().toLowerCase() !==
                            row.description.trim().toLowerCase() && (
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#8A8A8A]">
                              <span className="truncate">
                                Original: {row.originalDescription}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  updateItem(row.id, { description: row.originalDescription || '' })
                                }
                                className="shrink-0 font-medium text-[#C1121F] hover:underline"
                              >
                                Use original
                              </button>
                            </div>
                          )}

                        {row.reason && (
                          <p className="text-[11px] text-[#7A7A7A]">{row.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Desktop Review Table */}
                  <div className="hidden overflow-x-auto rounded-md border border-[#242424] md:block">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#C1121F]/70 bg-[#0B0B0B] font-semibold text-[#9A9A9A]">
                          <th className="px-2.5 py-2.5">Use</th>
                          <th className="px-2.5 py-2.5">FinanceDesk Section</th>
                          <th className="px-2.5 py-2.5">Date</th>
                          <th className="px-2.5 py-2.5">Activity / Type</th>
                          <th className="px-2.5 py-2.5">Category / Kind</th>
                          <th className="px-2.5 py-2.5">Description</th>
                          <th className="px-2.5 py-2.5 text-right">Amount (TZS)</th>
                          <th className="px-2.5 py-2.5 text-right">Del</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1E1E1E] bg-[#121212]">
                        {items.map((row) => (
                        <tr
                          key={row.id}
                          className={row.include ? 'hover:bg-[#171717]' : 'opacity-45 hover:bg-[#171717]'}
                        >
                          <td className="px-2.5 py-2 align-top">
                            <input
                              type="checkbox"
                              checked={row.include}
                              onChange={(e) => updateItem(row.id, { include: e.target.checked })}
                              className="mt-1.5 h-4 w-4 accent-[#C1121F]"
                            />
                          </td>

                          <td className="px-2.5 py-2 align-top">
                            <select
                              value={row.targetSection}
                              onChange={(e) =>
                                updateItem(row.id, {
                                  targetSection: e.target.value as StatementTargetSection,
                                })
                              }
                              className="h-8 w-36 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs text-white focus:border-[#C1121F] focus:outline-none"
                            >
                              {SECTION_LABELS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            {row.possibleDuplicate && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-300">
                                <AlertTriangle className="h-3 w-3" />
                                Duplicate?
                              </span>
                            )}
                          </td>

                          <td className="px-2.5 py-2 align-top">
                            <input
                              type="date"
                              value={row.date}
                              onChange={(e) => updateItem(row.id, { date: e.target.value })}
                              className="font-mono-nums h-8 w-32 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs text-white focus:border-[#C1121F] focus:outline-none"
                            />
                          </td>

                          <td className="px-2.5 py-2 align-top">
                            {row.targetSection === 'cashflow' ? (
                              <div className="flex flex-col gap-1">
                                <select
                                  value={row.activity}
                                  onChange={(e) =>
                                    updateItem(row.id, {
                                      activity: e.target.value as TransactionActivity,
                                    })
                                  }
                                  className="h-8 w-28 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs capitalize text-white focus:border-[#C1121F] focus:outline-none"
                                >
                                  <option value="operating">operating</option>
                                  <option value="investing">investing</option>
                                  <option value="financing">financing</option>
                                </select>
                                <select
                                  value={row.direction}
                                  onChange={(e) =>
                                    updateItem(row.id, {
                                      direction: e.target.value as 'income' | 'expense',
                                    })
                                  }
                                  className={`h-7 w-28 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-[11px] font-medium focus:border-[#C1121F] focus:outline-none ${
                                    row.direction === 'income' ? 'text-emerald-400' : 'text-red-400'
                                  }`}
                                >
                                  <option value="expense">Expense (-)</option>
                                  <option value="income">Income (+)</option>
                                </select>
                              </div>
                            ) : row.targetSection === 'holding' ? (
                              <input
                                type="text"
                                value={row.holdingSymbol || ''}
                                onChange={(e) =>
                                  updateItem(row.id, { holdingSymbol: e.target.value })
                                }
                                placeholder="Symbol"
                                className="h-8 w-28 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs text-white focus:border-[#C1121F] focus:outline-none"
                              />
                            ) : (
                              <select
                                value={row.balanceType}
                                onChange={(e) =>
                                  updateItem(row.id, {
                                    balanceType: e.target.value as BalanceType,
                                  })
                                }
                                className="h-8 w-28 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs text-white focus:border-[#C1121F] focus:outline-none"
                              >
                                {BALANCE_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          <td className="px-2.5 py-2 align-top">
                            {row.targetSection === 'cashflow' ? (
                              <select
                                value={row.category}
                                onChange={(e) => updateItem(row.id, { category: e.target.value })}
                                className="h-8 w-36 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs text-white focus:border-[#C1121F] focus:outline-none"
                              >
                                {!TRANSACTION_CATEGORIES.includes(
                                  row.category as (typeof TRANSACTION_CATEGORIES)[number]
                                ) && <option value={row.category}>{row.category}</option>}
                                {TRANSACTION_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            ) : row.targetSection === 'holding' ? (
                              <div className="flex flex-col gap-1">
                                <select
                                  value={row.holdingKind || 'Stock'}
                                  onChange={(e) =>
                                    updateItem(row.id, {
                                      holdingKind: e.target.value as HoldingKind,
                                    })
                                  }
                                  className="h-8 w-32 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs text-white focus:border-[#C1121F] focus:outline-none"
                                >
                                  {HOLDING_KINDS.map((k) => (
                                    <option key={k} value={k}>
                                      {k}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min="0"
                                  step="any"
                                  value={row.holdingUnits ?? 1}
                                  onChange={(e) =>
                                    updateItem(row.id, { holdingUnits: Number(e.target.value) || 0 })
                                  }
                                  placeholder="Units"
                                  className="font-mono-nums h-7 w-32 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-[11px] text-white"
                                />
                              </div>
                            ) : (
                              <span className="inline-block pt-1.5 text-[#8A8A8A]">Balance item</span>
                            )}
                          </td>

                          <td className="px-2.5 py-2 align-top">
                            <input
                              type="text"
                              value={row.description}
                              onChange={(e) => updateItem(row.id, { description: e.target.value })}
                              className="h-8 w-full min-w-[160px] rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-xs text-white focus:border-[#C1121F] focus:outline-none"
                            />
                            {row.originalDescription &&
                              row.originalDescription.trim().toLowerCase() !==
                                row.description.trim().toLowerCase() && (
                                <div className="mt-1 flex items-center gap-2 text-[10px] text-[#8A8A8A]">
                                  <span
                                    title={row.originalDescription}
                                    className="max-w-[210px] truncate"
                                  >
                                    Orig: {row.originalDescription}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateItem(row.id, {
                                        description: row.originalDescription || '',
                                      })
                                    }
                                    className="shrink-0 font-medium text-[#C1121F] hover:underline"
                                  >
                                    Use original
                                  </button>
                                </div>
                              )}
                            {row.reason && (
                              <p className="mt-1 text-[10px] text-[#7A7A7A]">{row.reason}</p>
                            )}
                          </td>

                          <td className="px-2.5 py-2 align-top text-right">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={Math.abs(Number(row.amount) || 0)}
                              onChange={(e) =>
                                updateItem(row.id, {
                                  amount: Math.abs(Number(e.target.value) || 0),
                                })
                              }
                              className="font-mono-nums h-8 w-28 rounded border border-[#2A2A2A] bg-[#0B0B0B] px-2 text-right text-xs text-white focus:border-[#C1121F] focus:outline-none"
                            />
                          </td>

                          <td className="px-2.5 py-2 align-top text-right">
                            <button
                              type="button"
                              onClick={() => removeItem(row.id)}
                              aria-label="Remove row"
                              className="mt-1 rounded p-1 text-[#8A8A8A] hover:bg-[#2A0A0D] hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}

              {importError && (
                <div
                  role="alert"
                  className="rounded-md border border-red-900/60 bg-[#1F0B0D] px-4 py-2.5 text-xs text-red-300"
                >
                  {importError}
                </div>
              )}

              {importSuccess && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-md border border-emerald-900/60 bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-300"
                >
                  <Check className="h-4 w-4 text-emerald-400" />
                  <span>{importSuccess}</span>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t border-[#222222] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-[#8A8A8A]">
                  Ready to save: {selectedSummary.cashflow} cash flow · {selectedSummary.balance}{' '}
                  balance · {selectedSummary.holdings} holdings
                  {syncClosingBalance && closingAmount.trim() !== '' ? ' + bank closing balance' : ''}
                </p>
                <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center">
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={importing}
                    className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmImport()}
                    disabled={importing}
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
                  >
                    {importing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Import Selected
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
