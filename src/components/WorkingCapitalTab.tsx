import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  CalendarPlus,
  FileDown,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  BALANCE_TYPES,
  BANK_OPTIONS,
  DEFAULT_FIXED_EXPENSE_TEMPLATE,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  TRANSACTION_CATEGORIES,
  type AppLanguage,
  type BalanceEntry,
  type BalanceSection,
  type BalanceType,
  type FinanceState,
  type MonthlyFixedExpense,
  type TransactionActivity,
  type TransactionEntry,
} from '../types';
import { formatAmount, formatShillings, todayIso } from '../utils/format';
import { getTranslations } from '../utils/i18n';
import { FixedExpensesEditor } from './FixedExpensesEditor';
import { KpiStrip } from './KpiStrip';
import { Modal } from './Modal';

interface WorkingCapitalTabProps {
  state: FinanceState;
  language: AppLanguage;
  onSaveBalance: (
    payload: {
      date: string;
      section: BalanceSection;
      type: BalanceType;
      name: string;
      amount: number;
    },
    id?: number
  ) => Promise<void>;
  onDeleteBalance: (id: number) => Promise<void>;
  onTransferBanks: (payload: {
    fromBank: string;
    toBank: string;
    amount: number;
    date: string;
  }) => Promise<void>;
  onSaveTransaction: (
    payload: {
      date: string;
      activity: TransactionActivity;
      category: string;
      description: string;
      amount: number;
      receiptId?: string;
      receiptName?: string;
      receiptMime?: string;
    },
    id?: number
  ) => Promise<void>;
  onAddTransactionsBatch: (
    items: Array<{
      date: string;
      activity: TransactionActivity;
      category: string;
      description: string;
      amount: number;
    }>
  ) => Promise<void>;
  onDeleteTransaction: (id: number) => Promise<void>;
  onUploadReceipt: (
    file: File
  ) => Promise<{ receiptId: string; receiptName: string; receiptMime: string }>;
  onFetchReceiptUrl: (receiptId: string) => Promise<string>;
  onOpenStatementImport: () => void;
  onSaveMonthlyDefaults: (items: MonthlyFixedExpense[]) => Promise<void>;
  onRequirePro: (feature: 'ai_import') => void;
}

const EXPENSE_SET = new Set<string>(EXPENSE_CATEGORIES);
const INCOME_SET = new Set<string>(INCOME_CATEGORIES);

export function WorkingCapitalTab({
  state,
  language,
  onSaveBalance,
  onDeleteBalance,
  onTransferBanks,
  onSaveTransaction,
  onAddTransactionsBatch,
  onDeleteTransaction,
  onUploadReceipt,
  onFetchReceiptUrl,
  onOpenStatementImport,
  onSaveMonthlyDefaults,
  onRequirePro,
}: WorkingCapitalTabProps) {
  const { balance, transactions, snapshot, runway, settings } = state;
  const currency = 'TZS';
  const t = getTranslations(language);
  const isPro = settings.plan === 'pro';

  const currentItems = useMemo(
    () => balance.filter((b) => b.section === 'current_asset' || b.section === 'current_liability'),
    [balance]
  );

  const [txQuery, setTxQuery] = useState('');
  const [txActivityFilter, setTxActivityFilter] = useState<'all' | TransactionActivity>('all');

  const filteredTx = useMemo(() => {
    const q = txQuery.trim().toLowerCase();
    return transactions.filter((t) => {
      if (txActivityFilter !== 'all' && t.activity !== txActivityFilter) return false;
      if (!q) return true;
      return (
        t.category.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.receiptName || '').toLowerCase().includes(q) ||
        t.date.includes(q)
      );
    });
  }, [transactions, txQuery, txActivityFilter]);

  const parseCleanAmount = (raw: string): number => {
    const cleaned = raw.replace(/,/g, '').trim();
    if (!cleaned) return Number.NaN;
    return Number(cleaned);
  };

  // Balance modal
  const [balModalOpen, setBalModalOpen] = useState(false);
  const [editingBal, setEditingBal] = useState<BalanceEntry | null>(null);
  const [balDate, setBalDate] = useState(todayIso());
  const [balSection, setBalSection] = useState<'current_asset' | 'current_liability'>(
    'current_asset'
  );
  const [balType, setBalType] = useState<BalanceType>('Cash in bank');
  const [balName, setBalName] = useState<string>(BANK_OPTIONS[0]);
  const [balAmount, setBalAmount] = useState('0');
  const [balError, setBalError] = useState('');
  const [savingBal, setSavingBal] = useState(false);

  const openAddBalance = () => {
    setEditingBal(null);
    setBalDate(todayIso());
    setBalSection('current_asset');
    setBalType('Cash in bank');
    setBalName(BANK_OPTIONS[0]);
    setBalAmount('0');
    setBalError('');
    setSavingBal(false);
    setBalModalOpen(true);
  };

  const openEditBalance = (row: BalanceEntry) => {
    setEditingBal(row);
    setBalDate(row.date || todayIso());
    setBalSection(row.section === 'current_liability' ? 'current_liability' : 'current_asset');
    setBalType(row.type);
    setBalName(row.name);
    setBalAmount(String(row.amount));
    setBalError('');
    setSavingBal(false);
    setBalModalOpen(true);
  };

  const handleBalTypeChange = (nextType: BalanceType) => {
    setBalType(nextType);
    if (nextType === 'Cash in bank') {
      if (!BANK_OPTIONS.includes(balName as (typeof BANK_OPTIONS)[number])) {
        setBalName(BANK_OPTIONS[0]);
      }
    } else if (BANK_OPTIONS.includes(balName as (typeof BANK_OPTIONS)[number])) {
      setBalName('');
    }
  };

  const submitBalance = async (e: FormEvent) => {
    e.preventDefault();
    setBalError('');
    const num = parseCleanAmount(balAmount);
    if (!balName.trim()) {
      setBalError(balType === 'Cash in bank' ? 'Please select a bank.' : 'Description is required.');
      return;
    }
    if (!Number.isFinite(num)) {
      setBalError('Enter a valid amount.');
      return;
    }
    setSavingBal(true);
    try {
      await onSaveBalance(
        {
          date: balDate || todayIso(),
          section: balSection,
          type: balType,
          name: balName.trim(),
          amount: num,
        },
        editingBal?.id
      );
      setBalModalOpen(false);
    } catch (err) {
      setBalError((err as Error).message || 'Failed to save entry.');
    } finally {
      setSavingBal(false);
    }
  };

  // Bank transfer modal & feedback
  const bankAccounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of BANK_OPTIONS) {
      map.set(b, 0);
    }
    for (const row of currentItems) {
      if (row.section === 'current_asset' && row.type === 'Cash in bank' && row.name.trim()) {
        map.set(row.name.trim(), (map.get(row.name.trim()) || 0) + (Number(row.amount) || 0));
      }
    }
    return [...map.entries()].map(([name, balanceAmount]) => ({ name, balanceAmount }));
  }, [currentItems]);

  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [fromBank, setFromBank] = useState<string>(BANK_OPTIONS[0]);
  const [toBank, setToBank] = useState<string>(BANK_OPTIONS[1]);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate, setTransferDate] = useState(todayIso());
  const [transferError, setTransferError] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [wcNotice, setWcNotice] = useState('');

  const openTransferModal = () => {
    const funded = bankAccounts.find((b) => b.balanceAmount > 0)?.name || bankAccounts[0]?.name || BANK_OPTIONS[0];
    const dest =
      bankAccounts.find((b) => b.name !== funded)?.name || BANK_OPTIONS[1] || BANK_OPTIONS[0];
    setFromBank(funded);
    setToBank(dest);
    setTransferAmount('');
    setTransferDate(todayIso());
    setTransferError('');
    setTransferring(false);
    setTransferModalOpen(true);
  };

  const submitTransfer = async (e: FormEvent) => {
    e.preventDefault();
    setTransferError('');
    const num = parseCleanAmount(transferAmount);
    if (!fromBank || !toBank) {
      setTransferError('Select both source and destination bank accounts.');
      return;
    }
    if (fromBank.toLowerCase() === toBank.toLowerCase()) {
      setTransferError('Source and destination bank accounts must be different.');
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
      setTransferError('Enter a valid positive transfer amount.');
      return;
    }
    setTransferring(true);
    try {
      await onTransferBanks({
        fromBank,
        toBank,
        amount: num,
        date: transferDate || todayIso(),
      });
      setTransferModalOpen(false);
      setWcNotice(
        `Transferred ${formatShillings(num, currency, 0)} from ${fromBank} to ${toBank}.`
      );
    } catch (err) {
      setTransferError((err as Error).message || 'Bank transfer failed.');
    } finally {
      setTransferring(false);
    }
  };

  // Monthly Default preset expenses (per-user customizable)
  const [addingDefault, setAddingDefault] = useState(false);
  const [ledgerNotice, setLedgerNotice] = useState('');
  const [ledgerError, setLedgerError] = useState('');
  const [defaultsModalOpen, setDefaultsModalOpen] = useState(false);
  const [draftDefaults, setDraftDefaults] = useState<MonthlyFixedExpense[]>([]);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState('');

  const activeMonthlyDefaults = useMemo(
    () =>
      (state.settings.monthlyFixedExpenses || []).filter(
        (item) => item.description.trim().length > 0 && Number(item.amount) > 0
      ),
    [state.settings.monthlyFixedExpenses]
  );

  const openEditDefaultsModal = (noticeMsg = '') => {
    const base =
      state.settings.monthlyFixedExpenses && state.settings.monthlyFixedExpenses.length > 0
        ? state.settings.monthlyFixedExpenses
        : DEFAULT_FIXED_EXPENSE_TEMPLATE;
    setDraftDefaults(base.map((item) => ({ ...item })));
    setDefaultsError(noticeMsg);
    setSavingDefaults(false);
    setDefaultsModalOpen(true);
  };

  const submitMonthlyDefaults = async (e: FormEvent) => {
    e.preventDefault();
    setDefaultsError('');
    const cleaned = draftDefaults
      .map((item, idx) => ({
        id: item.id || `exp-${idx + 1}`,
        category: item.category || 'Other',
        description: item.description.trim(),
        amount: Number.isFinite(item.amount) && item.amount >= 0 ? item.amount : 0,
      }))
      .filter((item) => item.description.length > 0);

    setSavingDefaults(true);
    try {
      await onSaveMonthlyDefaults(cleaned);
      setDefaultsModalOpen(false);
      const count = cleaned.filter((i) => i.amount > 0).length;
      setLedgerNotice(
        `Saved ${count} active Monthly Default fixed ${count === 1 ? 'expense' : 'expenses'}.`
      );
    } catch (err) {
      setDefaultsError((err as Error).message || 'Could not save fixed expense defaults.');
    } finally {
      setSavingDefaults(false);
    }
  };

  const handleAddMonthlyDefault = async () => {
    if (addingDefault) return;
    setLedgerNotice('');
    setLedgerError('');
    if (activeMonthlyDefaults.length === 0) {
      openEditDefaultsModal(
        'Fill in at least one fixed expense amount below before applying Monthly Default.'
      );
      return;
    }
    setAddingDefault(true);
    const today = todayIso();
    try {
      await onAddTransactionsBatch(
        activeMonthlyDefaults.map((item) => ({
          date: today,
          activity: 'operating',
          category: item.category,
          description: item.description,
          amount: -Math.abs(item.amount),
        }))
      );
      const totalAmt = activeMonthlyDefaults.reduce((s, item) => s + Math.abs(item.amount), 0);
      const labels = activeMonthlyDefaults.map((i) => i.description).join(', ');
      setLedgerNotice(
        `Added ${activeMonthlyDefaults.length} Monthly Default expense(s) (-${Math.round(totalAmt).toLocaleString('en-US')} TZS total): ${labels}.`
      );
    } catch (err) {
      setLedgerError((err as Error).message || 'Could not add Monthly Default expenses.');
    } finally {
      setAddingDefault(false);
    }
  };

  // Transaction modal
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionEntry | null>(null);
  const [txDate, setTxDate] = useState(todayIso());
  const [txActivity, setTxActivity] = useState<TransactionActivity>('operating');
  const [txDirection, setTxDirection] = useState<'income' | 'expense'>('expense');
  const [txCategory, setTxCategory] = useState<string>('Food & groceries');
  const [txDesc, setTxDesc] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txReceiptId, setTxReceiptId] = useState('');
  const [txReceiptName, setTxReceiptName] = useState('');
  const [txReceiptMime, setTxReceiptMime] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [txError, setTxError] = useState('');
  const [savingTx, setSavingTx] = useState(false);

  // Receipt Viewer modal
  const [receiptPreview, setReceiptPreview] = useState<{
    name: string;
    mime: string;
    blobUrl: string;
  } | null>(null);
  const [receiptLoadError, setReceiptLoadError] = useState('');
  const receiptUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (receiptUrlRef.current) {
        URL.revokeObjectURL(receiptUrlRef.current);
      }
    };
  }, []);

  const openAddTx = () => {
    setEditingTx(null);
    setTxDate(todayIso());
    setTxActivity('operating');
    setTxDirection('expense');
    setTxCategory('Food & groceries');
    setTxDesc('');
    setTxAmount('');
    setTxReceiptId('');
    setTxReceiptName('');
    setTxReceiptMime('');
    setUploadingReceipt(false);
    setTxError('');
    setSavingTx(false);
    setTxModalOpen(true);
  };

  const openEditTx = (row: TransactionEntry) => {
    setEditingTx(row);
    setTxDate(row.date || todayIso());
    setTxActivity(row.activity);
    setTxDirection(row.amount < 0 ? 'expense' : 'income');
    setTxCategory(row.category);
    setTxDesc(row.description);
    setTxAmount(String(Math.abs(row.amount)));
    setTxReceiptId(row.receiptId || '');
    setTxReceiptName(row.receiptName || '');
    setTxReceiptMime(row.receiptMime || '');
    setUploadingReceipt(false);
    setTxError('');
    setSavingTx(false);
    setTxModalOpen(true);
  };

  const handleCategoryChange = (nextCategory: string) => {
    setTxCategory(nextCategory);
    if (EXPENSE_SET.has(nextCategory) || /expense|rent|food|bill|utility|tax/i.test(nextCategory)) {
      setTxDirection('expense');
    } else if (INCOME_SET.has(nextCategory) || /salary|income|dividend|sale/i.test(nextCategory)) {
      setTxDirection('income');
    }
  };

  const handleTxAmountChange = (raw: string) => {
    if (raw.trim().startsWith('-')) {
      setTxDirection('expense');
    }
    setTxAmount(raw);
  };

  const handleReceiptFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setTxError('');
    setUploadingReceipt(true);
    try {
      const uploaded = await onUploadReceipt(file);
      setTxReceiptId(uploaded.receiptId);
      setTxReceiptName(uploaded.receiptName);
      setTxReceiptMime(uploaded.receiptMime);
    } catch (err) {
      setTxError((err as Error).message || 'Receipt upload failed.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const handleViewReceipt = async (row: TransactionEntry) => {
    if (!row.receiptId) return;
    setReceiptLoadError('');
    try {
      const url = await onFetchReceiptUrl(row.receiptId);
      if (receiptUrlRef.current) {
        URL.revokeObjectURL(receiptUrlRef.current);
      }
      receiptUrlRef.current = url;
      setReceiptPreview({
        name: row.receiptName || row.receiptId,
        mime: row.receiptMime || 'application/octet-stream',
        blobUrl: url,
      });
    } catch (err) {
      setReceiptLoadError((err as Error).message || 'Could not load receipt file.');
    }
  };

  const submitTx = async (e: FormEvent) => {
    e.preventDefault();
    setTxError('');
    const num = parseCleanAmount(txAmount);
    if (!txCategory.trim()) {
      setTxError('Category is required.');
      return;
    }
    if (!Number.isFinite(num) || num === 0) {
      setTxError('Enter a non-zero transaction amount.');
      return;
    }

    const signedAmount =
      txDirection === 'expense' ? -Math.abs(num) : Math.abs(num);

    setSavingTx(true);
    try {
      await onSaveTransaction(
        {
          date: txDate || todayIso(),
          activity: txActivity,
          category: txCategory.trim(),
          description: txDesc.trim(),
          amount: signedAmount,
          receiptId: txReceiptId,
          receiptName: txReceiptName,
          receiptMime: txReceiptMime,
        },
        editingTx?.id
      );
      setTxModalOpen(false);
    } catch (err) {
      setTxError((err as Error).message || 'Failed to save transaction.');
    } finally {
      setSavingTx(false);
    }
  };

  const currentRatio = snapshot.cl > 0 ? (snapshot.ca / snapshot.cl).toFixed(2) : 'n/a';

  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          {
            label: 'Working capital',
            value: formatShillings(snapshot.wc, currency),
            tone: snapshot.wc > 0 ? 'positive' : snapshot.wc < 0 ? 'negative' : 'default',
          },
          {
            label: 'Current ratio',
            value: currentRatio,
            sublabel: 'Current assets / liabilities',
          },
          {
            label: 'Monthly burn',
            value: formatShillings(runway.burn, currency),
            sublabel: '90-day operating outflow avg',
          },
          {
            label: 'Cash runway',
            value: runway.months !== null ? `${runway.months.toFixed(1)} months` : 'n/a',
            sublabel: 'Bank + hand cash coverage',
          },
        ]}
      />

      <section className="rounded-lg border border-[#242424] bg-[#121212]">
        <div className="flex flex-col gap-3 border-b border-[#222222] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-white">{t.wcTitleAssets}</h2>
            <p className="mt-0.5 text-xs text-[#808080]">
              Cash in bank, cash in hand, short-term receivables, and payables in TZS.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={openTransferModal}
              className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0 sm:px-3.5"
            >
              <ArrowLeftRight className="h-3.5 w-3.5 text-[#C1121F]" />
              {t.moveBetweenBanks}
            </button>
            <button
              type="button"
              onClick={openAddBalance}
              className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#C1121F] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] sm:min-h-0 sm:px-3.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.addEntry}
            </button>
          </div>
        </div>

        {wcNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 border-b border-[#242424] bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-300 sm:px-5"
          >
            <span>{wcNotice}</span>
            <button
              type="button"
              onClick={() => setWcNotice('')}
              aria-label="Dismiss notice"
              className="text-emerald-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {currentItems.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9A9A9A]">
              No current assets or liabilities recorded yet.
            </p>
            <button
              type="button"
              onClick={openAddBalance}
              className="mt-3 min-h-[40px] rounded-md border border-[#303030] px-4 py-2 text-xs font-medium text-white transition-colors hover:border-[#C1121F]"
            >
              Add Current Asset or Liability
            </button>
          </div>
        ) : (
          <>
            {/* Mobile stacked list */}
            <div className="divide-y divide-[#1E1E1E] md:hidden">
              {currentItems.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{row.name}</p>
                    <p className="mt-0.5 text-xs text-[#8E8E8E]">
                      {row.section === 'current_asset' ? 'Assets' : 'Liabilities'} · {row.type}
                    </p>
                    <p className="font-mono-nums mt-0.5 text-[11px] text-[#737373]">{row.date}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-mono-nums text-sm font-semibold text-white">
                      {formatShillings(row.amount, currency, 0)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditBalance(row)}
                        aria-label={`Edit ${row.name}`}
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteBalance(row.id)}
                        aria-label={`Delete ${row.name}`}
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:bg-[#2A0A0D] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#C1121F]/70 bg-[#0E0E0E] text-xs font-semibold text-[#9A9A9A]">
                    <th className="px-4 py-3">As at</th>
                    <th className="px-4 py-3">Class</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount ({currency})</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E1E]">
                  {currentItems.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-[#171717]">
                      <td className="font-mono-nums whitespace-nowrap px-4 py-2.5 text-xs text-[#9A9A9A]">
                        {row.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#D0D0D0]">
                        {row.section === 'current_asset' ? 'Assets' : 'Liabilities'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#A0A0A0]">
                        {row.type}
                      </td>
                      <td className="px-4 py-2.5 text-white">{row.name}</td>
                      <td className="font-mono-nums whitespace-nowrap px-4 py-2.5 text-right font-medium text-white">
                        {formatAmount(row.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditBalance(row)}
                            aria-label={`Edit ${row.name}`}
                            className="rounded p-1.5 text-[#8A8A8A] transition-colors hover:bg-[#222222] hover:text-white"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteBalance(row.id)}
                            aria-label={`Delete ${row.name}`}
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

      <section className="rounded-lg border border-[#242424] bg-[#121212]">
        <div className="flex flex-col gap-3.5 border-b border-[#222222] px-4 py-4 sm:px-5 xl:flex-row xl:flex-wrap xl:items-center xl:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">{t.wcTitleLedger}</h2>
            <p className="mt-0.5 text-xs text-[#808080]">
              Expenses automatically record as negative (-), with optional receipt attachments in{' '}
              {currency}.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:w-44">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#787878]" />
              <input
                type="search"
                value={txQuery}
                onChange={(e) => setTxQuery(e.target.value)}
                placeholder="Search ledger..."
                className="h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] pr-3 pl-8 text-base text-white placeholder-[#686868] focus:border-[#C1121F] focus:outline-none sm:h-8 sm:text-xs"
              />
            </div>

            <div className="grid w-full grid-cols-4 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] p-0.5 sm:flex sm:w-auto sm:items-center">
              {(['all', 'operating', 'investing', 'financing'] as const).map((act) => (
                <button
                  key={act}
                  type="button"
                  onClick={() => setTxActivityFilter(act)}
                  className={`min-h-[36px] whitespace-nowrap rounded px-2 py-1 text-xs font-medium capitalize transition-colors sm:min-h-0 sm:px-2.5 ${
                    txActivityFilter === act
                      ? 'bg-[#222222] text-white'
                      : 'text-[#8A8A8A] hover:text-white'
                  }`}
                >
                  {act}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => {
                  if (!isPro) {
                    onRequirePro('ai_import');
                    return;
                  }
                  onOpenStatementImport();
                }}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0"
              >
                {isPro ? (
                  <Sparkles className="h-3.5 w-3.5 text-[#C1121F]" />
                ) : (
                  <Lock className="h-3.5 w-3.5 text-[#C1121F]" />
                )}
                {t.importStatementAi}
              </button>

              <button
                type="button"
                onClick={() => openEditDefaultsModal()}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#CCCCCC] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit Defaults
              </button>

              <button
                type="button"
                onClick={() => void handleAddMonthlyDefault()}
                disabled={addingDefault}
                title={
                  activeMonthlyDefaults.length > 0
                    ? `Adds ${activeMonthlyDefaults.length} fixed expense(s) totaling ${formatShillings(
                        activeMonthlyDefaults.reduce((s, i) => s + i.amount, 0),
                        currency,
                        0
                      )}`
                    : 'Configure your Monthly Default fixed expenses'
                }
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-2 text-xs font-medium text-[#E0E0E0] transition-colors hover:border-[#C1121F] hover:text-white disabled:opacity-50 sm:min-h-0"
              >
                <CalendarPlus className="h-3.5 w-3.5 text-[#C1121F]" />
                {addingDefault ? 'Adding...' : t.monthlyDefaultsBtn}
              </button>

              <button
                type="button"
                onClick={openAddTx}
                className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#C1121F] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] sm:min-h-0"
              >
                <Plus className="h-3.5 w-3.5" />
                {t.logTransaction}
              </button>
            </div>
          </div>
        </div>

        {ledgerNotice && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 border-b border-[#242424] bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-300 sm:px-5"
          >
            <span>{ledgerNotice}</span>
            <button
              type="button"
              onClick={() => setLedgerNotice('')}
              aria-label="Dismiss notice"
              className="text-emerald-400 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {(receiptLoadError || ledgerError) && (
          <div role="alert" className="border-b border-[#242424] bg-[#1F0B0D] px-4 py-2.5 text-xs text-red-300 sm:px-5">
            {ledgerError || receiptLoadError}
          </div>
        )}

        {filteredTx.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9A9A9A]">
              {transactions.length === 0
                ? 'No cash flow transactions logged yet.'
                : 'No transactions match your current filter.'}
            </p>
            {transactions.length === 0 && (
              <button
                type="button"
                onClick={openAddTx}
                className="mt-3 min-h-[40px] rounded-md border border-[#303030] px-4 py-2 text-xs font-medium text-white transition-colors hover:border-[#C1121F]"
              >
                Log First Transaction
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile stacked cash flow list */}
            <div className="divide-y divide-[#1E1E1E] md:hidden">
              {filteredTx.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{row.category}</p>
                    {row.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[#CCCCCC]">{row.description}</p>
                    )}
                    <p className="font-mono-nums mt-1 text-[11px] capitalize text-[#8A8A8A]">
                      {row.date} · {row.activity}
                    </p>
                    {row.receiptId && (
                      <button
                        type="button"
                        onClick={() => void handleViewReceipt(row)}
                        className="mt-1.5 inline-flex min-h-[32px] items-center gap-1.5 text-xs text-[#E0E0E0] hover:text-[#C1121F]"
                      >
                        <Paperclip className="h-3.5 w-3.5 text-[#C1121F]" />
                        <span className="max-w-[180px] truncate">
                          {row.receiptName || 'View receipt'}
                        </span>
                      </button>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span
                      className={`font-mono-nums text-sm font-semibold ${
                        row.amount > 0
                          ? 'text-emerald-400'
                          : row.amount < 0
                            ? 'text-red-400'
                            : 'text-white'
                      }`}
                    >
                      {formatAmount(row.amount)}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditTx(row)}
                        aria-label={`Edit ${row.category}`}
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteTransaction(row.id)}
                        aria-label={`Delete ${row.category}`}
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded border border-[#242424] text-[#9A9A9A] hover:bg-[#2A0A0D] hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#C1121F]/70 bg-[#0E0E0E] text-xs font-semibold text-[#9A9A9A]">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Activity</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Receipt</th>
                    <th className="px-4 py-3 text-right">Amount ({currency})</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E1E1E]">
                  {filteredTx.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-[#171717]">
                      <td className="font-mono-nums whitespace-nowrap px-4 py-2.5 text-xs text-[#9A9A9A]">
                        {row.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs capitalize text-[#B0B0B0]">
                        {row.activity}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-white">{row.category}</td>
                      <td className="px-4 py-2.5 text-[#CCCCCC]">{row.description || '-'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {row.receiptId ? (
                          <button
                            type="button"
                            onClick={() => void handleViewReceipt(row)}
                            className="inline-flex items-center gap-1.5 text-[#E0E0E0] transition-colors hover:text-[#C1121F]"
                          >
                            <Paperclip className="h-3.5 w-3.5 text-[#C1121F]" />
                            <span className="max-w-[140px] truncate">
                              {row.receiptName || 'View receipt'}
                            </span>
                          </button>
                        ) : (
                          <span className="text-[#666666]">-</span>
                        )}
                      </td>
                      <td
                        className={`font-mono-nums whitespace-nowrap px-4 py-2.5 text-right font-medium ${
                          row.amount > 0
                            ? 'text-emerald-400'
                            : row.amount < 0
                              ? 'text-red-400'
                              : 'text-white'
                        }`}
                      >
                        {formatAmount(row.amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditTx(row)}
                            aria-label={`Edit ${row.category}`}
                            className="rounded p-1.5 text-[#8A8A8A] transition-colors hover:bg-[#222222] hover:text-white"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteTransaction(row.id)}
                            aria-label={`Delete ${row.category}`}
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

      <Modal
        open={balModalOpen}
        title={editingBal ? 'Edit Working Capital Entry' : 'Add Working Capital Entry'}
        onClose={() => setBalModalOpen(false)}
      >
        <form onSubmit={(e) => void submitBalance(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>As at</span>
              <input
                type="date"
                value={balDate}
                onChange={(e) => setBalDate(e.target.value)}
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Class</span>
              <select
                value={balSection}
                onChange={(e) =>
                  setBalSection(e.target.value as 'current_asset' | 'current_liability')
                }
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                <option value="current_asset">Assets</option>
                <option value="current_liability">Liabilities</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>Type</span>
            <select
              value={balType}
              onChange={(e) => handleBalTypeChange(e.target.value as BalanceType)}
              className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
            >
              {BALANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {balType === 'Cash in bank' ? (
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Bank</span>
              <select
                value={balName}
                onChange={(e) => setBalName(e.target.value)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                {!BANK_OPTIONS.includes(balName as (typeof BANK_OPTIONS)[number]) && balName && (
                  <option value={balName}>{balName}</option>
                )}
                {BANK_OPTIONS.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Description</span>
              <input
                type="text"
                value={balName}
                onChange={(e) => setBalName(e.target.value)}
                placeholder="e.g., Cash wallet or trade receivable"
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>Amount (TZS)</span>
            <input
              type="text"
              inputMode="decimal"
              value={balAmount}
              onChange={(e) => setBalAmount(e.target.value)}
              className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
            />
          </label>

          {balError && (
            <p role="alert" className="text-xs text-red-400">
              {balError}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setBalModalOpen(false)}
              disabled={savingBal}
              className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingBal}
              className="min-h-[44px] rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
            >
              {savingBal ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={txModalOpen}
        title={editingTx ? 'Edit Transaction' : 'Add Transaction'}
        onClose={() => setTxModalOpen(false)}
      >
        <form onSubmit={(e) => void submitTx(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Date</span>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Activity</span>
              <select
                value={txActivity}
                onChange={(e) => setTxActivity(e.target.value as TransactionActivity)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                <option value="operating">Operating</option>
                <option value="investing">Investing</option>
                <option value="financing">Financing</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Entry type</span>
              <div className="grid h-10 grid-cols-2 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] p-0.5 sm:h-9">
                <button
                  type="button"
                  onClick={() => setTxDirection('expense')}
                  className={`rounded text-xs font-medium transition-colors ${
                    txDirection === 'expense'
                      ? 'bg-[#C1121F] text-white'
                      : 'text-[#8A8A8A] hover:text-white'
                  }`}
                >
                  Expense (-)
                </button>
                <button
                  type="button"
                  onClick={() => setTxDirection('income')}
                  className={`rounded text-xs font-medium transition-colors ${
                    txDirection === 'income'
                      ? 'bg-emerald-700 text-white'
                      : 'text-[#8A8A8A] hover:text-white'
                  }`}
                >
                  Income (+)
                </button>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Category</span>
              <input
                list="tx-category-options"
                value={txCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
              <datalist id="tx-category-options">
                {TRANSACTION_CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>Description</span>
            <input
              type="text"
              value={txDesc}
              onChange={(e) => setTxDesc(e.target.value)}
              placeholder="Optional notes"
              className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>
              Amount (TZS · stored automatically as{' '}
              {txDirection === 'expense' ? 'negative (-)' : 'positive (+)'})
            </span>
            <div className="relative flex items-center">
              <span
                className={`font-mono-nums pointer-events-none absolute left-3 text-sm font-semibold ${
                  txDirection === 'expense' ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {txDirection === 'expense' ? '-' : '+'}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={txAmount}
                onChange={(e) => handleTxAmountChange(e.target.value)}
                placeholder="e.g., 50,000"
                className="font-mono-nums h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] pr-3 pl-7 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </div>
          </label>

          <div className="space-y-2 rounded-md border border-[#242424] bg-[#0B0B0B] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[#A0A0A0]">Receipt attachment (optional)</span>
              <span className="text-[11px] text-[#707070]">JPG, PNG, WEBP, PDF · max 4 MB</span>
            </div>

            {txReceiptId ? (
              <div className="flex items-center justify-between gap-2 rounded border border-[#262626] bg-[#121212] px-3 py-2 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-white">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[#C1121F]" />
                  <span className="truncate">{txReceiptName || txReceiptId}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTxReceiptId('');
                    setTxReceiptName('');
                    setTxReceiptMime('');
                  }}
                  className="shrink-0 text-xs text-[#9A9A9A] hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#303030] px-3 py-2.5 text-xs text-[#CCCCCC] transition-colors hover:border-[#C1121F] hover:text-white">
                <Upload className="h-3.5 w-3.5" />
                <span>{uploadingReceipt ? 'Uploading receipt...' : 'Upload Receipt'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  disabled={uploadingReceipt}
                  onChange={(e) => void handleReceiptFileChange(e)}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {txError && (
            <p role="alert" className="text-xs text-red-400">
              {txError}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setTxModalOpen(false)}
              disabled={savingTx || uploadingReceipt}
              className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingTx || uploadingReceipt}
              className="min-h-[44px] rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
            >
              {savingTx ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {receiptPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Receipt: ${receiptPreview.name}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
        >
          <div className="flex h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-[#2C2C2C] bg-[#121212] sm:h-auto sm:max-h-[88vh] sm:rounded-lg">
            <div className="flex items-center justify-between gap-2 border-b border-[#242424] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-white">{receiptPreview.name}</h3>
                <p className="text-xs text-[#8A8A8A]">Attached transaction receipt</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={receiptPreview.blobUrl}
                  download={receiptPreview.name}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-md bg-[#C1121F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#D91A28]"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setReceiptPreview(null)}
                  aria-label="Close receipt preview"
                  className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded text-[#9A9A9A] hover:bg-[#222222] hover:text-white sm:min-h-0 sm:min-w-0 sm:p-1.5"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="pb-safe flex-1 overflow-auto bg-[#0B0B0B] p-4">
              {receiptPreview.mime === 'application/pdf' ? (
                <iframe
                  src={receiptPreview.blobUrl}
                  title={receiptPreview.name}
                  className="h-[70vh] w-full bg-white"
                />
              ) : (
                <img
                  src={receiptPreview.blobUrl}
                  alt={receiptPreview.name}
                  className="mx-auto max-h-[70vh] rounded object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}

      <Modal
        open={transferModalOpen}
        title="Move Money Between Bank Accounts"
        onClose={() => setTransferModalOpen(false)}
      >
        <form onSubmit={(e) => void submitTransfer(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>From Bank</span>
              <select
                value={fromBank}
                onChange={(e) => setFromBank(e.target.value)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                {bankAccounts.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name} ({formatShillings(b.balanceAmount, currency, 0)})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>To Bank</span>
              <select
                value={toBank}
                onChange={(e) => setToBank(e.target.value)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                {bankAccounts.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name} ({formatShillings(b.balanceAmount, currency, 0)})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Amount ({currency})</span>
              <input
                type="text"
                inputMode="decimal"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="e.g., 150,000"
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Transfer Date</span>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
          </div>

          {transferError && (
            <p role="alert" className="text-xs text-red-400">
              {transferError}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setTransferModalOpen(false)}
              disabled={transferring}
              className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={transferring}
              className="min-h-[44px] rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
            >
              {transferring ? 'Moving...' : 'Transfer Funds'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={defaultsModalOpen}
        title="Configure Monthly Fixed Expenses"
        size="lg"
        onClose={() => setDefaultsModalOpen(false)}
      >
        <form onSubmit={(e) => void submitMonthlyDefaults(e)} className="space-y-4">
          {defaultsError && (
            <p role="alert" className="text-xs text-amber-300">
              {defaultsError}
            </p>
          )}
          <FixedExpensesEditor items={draftDefaults} onChange={setDraftDefaults} />
          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setDefaultsModalOpen(false)}
              disabled={savingDefaults}
              className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingDefaults}
              className="min-h-[44px] rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
            >
              {savingDefaults ? 'Saving...' : 'Save Fixed Defaults'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
