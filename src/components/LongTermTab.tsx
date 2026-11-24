import { useMemo, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  BALANCE_TYPES,
  BANK_OPTIONS,
  type AppLanguage,
  type BalanceEntry,
  type BalanceSection,
  type BalanceType,
  type FinanceState,
} from '../types';
import { formatAmount, formatShillings, todayIso } from '../utils/format';
import { getTranslations } from '../utils/i18n';
import { KpiStrip } from './KpiStrip';
import { Modal } from './Modal';

interface LongTermTabProps {
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
}

export function LongTermTab({ state, language, onSaveBalance, onDeleteBalance }: LongTermTabProps) {
  const { balance, snapshot } = state;
  const currency = 'TZS';
  const t = getTranslations(language);

  const longTermItems = useMemo(
    () => balance.filter((b) => b.section === 'longterm_asset' || b.section === 'longterm_liability'),
    [balance]
  );

  const totalAssets = snapshot.ca + snapshot.la;
  const totalLiabilities = snapshot.cl + snapshot.ll;
  const debtToAssets = totalAssets > 0 ? `${((totalLiabilities / totalAssets) * 100).toFixed(1)}%` : 'n/a';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BalanceEntry | null>(null);
  const [date, setDate] = useState(todayIso());
  const [section, setSection] = useState<'longterm_asset' | 'longterm_liability'>('longterm_asset');
  const [type, setType] = useState<BalanceType>('Property');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('0');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setDate(todayIso());
    setSection('longterm_asset');
    setType('Property');
    setName('');
    setAmount('0');
    setError('');
    setSaving(false);
    setModalOpen(true);
  };

  const openEdit = (row: BalanceEntry) => {
    setEditing(row);
    setDate(row.date || todayIso());
    setSection(row.section === 'longterm_liability' ? 'longterm_liability' : 'longterm_asset');
    setType(row.type);
    setName(row.name);
    setAmount(String(row.amount));
    setError('');
    setSaving(false);
    setModalOpen(true);
  };

  const handleTypeChange = (nextType: BalanceType) => {
    setType(nextType);
    if (nextType === 'Cash in bank') {
      if (!BANK_OPTIONS.includes(name as (typeof BANK_OPTIONS)[number])) {
        setName(BANK_OPTIONS[0]);
      }
    } else if (BANK_OPTIONS.includes(name as (typeof BANK_OPTIONS)[number])) {
      setName('');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const cleaned = amount.replace(/,/g, '').trim();
    const num = cleaned ? Number(cleaned) : Number.NaN;
    if (!name.trim()) {
      setError(type === 'Cash in bank' ? 'Please select a bank.' : 'Description is required.');
      return;
    }
    if (!Number.isFinite(num)) {
      setError('Enter a valid amount.');
      return;
    }
    setSaving(true);
    try {
      await onSaveBalance(
        {
          date: date || todayIso(),
          section,
          type,
          name: name.trim(),
          amount: num,
        },
        editing?.id
      );
      setModalOpen(false);
    } catch (err) {
      setError((err as Error).message || 'Failed to save entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          {
            label: 'Long-term assets',
            value: formatShillings(snapshot.la, currency),
            sublabel: `Includes ${formatShillings(snapshot.port, currency)} portfolio`,
          },
          {
            label: 'Long-term liabilities',
            value: formatShillings(snapshot.ll, currency),
          },
          {
            label: t.kpiNetWorth,
            value: formatShillings(snapshot.nw, currency),
            tone: snapshot.nw > 0 ? 'positive' : snapshot.nw < 0 ? 'negative' : 'default',
          },
          {
            label: 'Debt to assets',
            value: debtToAssets,
            sublabel: 'Total liabilities / total assets',
          },
        ]}
      />

      <section className="rounded-lg border border-[#242424] bg-[#121212]">
        <div className="flex flex-col gap-3 border-b border-[#222222] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-white">{t.ltTitleLedger}</h2>
            <p className="mt-0.5 text-xs text-[#808080]">
              Your investment portfolio market value ({formatShillings(snapshot.port, currency)}) is added automatically to long-term assets.
            </p>
          </div>
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-[#C1121F] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] sm:min-h-0 sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            {t.addEntry}
          </button>
        </div>

        {longTermItems.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-[#9A9A9A]">
              No manual long-term property, loan, or equity entries yet.
            </p>
            <button
              type="button"
              onClick={openAdd}
              className="mt-3 min-h-[40px] rounded-md border border-[#303030] px-4 py-2 text-xs font-medium text-white transition-colors hover:border-[#C1121F]"
            >
              Add Long-Term Entry
            </button>
          </div>
        ) : (
          <>
            {/* Mobile stacked list */}
            <div className="divide-y divide-[#1E1E1E] md:hidden">
              {longTermItems.map((row) => (
                <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{row.name}</p>
                    <p className="mt-0.5 text-xs text-[#8E8E8E]">
                      {row.section === 'longterm_asset' ? 'Assets' : 'Liabilities'} · {row.type}
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
                        onClick={() => openEdit(row)}
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
                  {longTermItems.map((row) => (
                    <tr key={row.id} className="transition-colors hover:bg-[#171717]">
                      <td className="font-mono-nums whitespace-nowrap px-4 py-2.5 text-xs text-[#9A9A9A]">
                        {row.date}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-[#D0D0D0]">
                        {row.section === 'longterm_asset' ? 'Assets' : 'Liabilities'}
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
                            onClick={() => openEdit(row)}
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

      <Modal
        open={modalOpen}
        title={editing ? 'Edit Long-Term Entry' : 'Add Long-Term Entry'}
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>As at</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Class</span>
              <select
                value={section}
                onChange={(e) =>
                  setSection(e.target.value as 'longterm_asset' | 'longterm_liability')
                }
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                <option value="longterm_asset">Assets</option>
                <option value="longterm_liability">Liabilities</option>
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>Type</span>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as BalanceType)}
              className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
            >
              {BALANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {type === 'Cash in bank' ? (
            <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
              <span>Bank</span>
              <select
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              >
                {!BANK_OPTIONS.includes(name as (typeof BANK_OPTIONS)[number]) && name && (
                  <option value={name}>{name}</option>
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Land plot"
                className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-[#A0A0A0]">
            <span>Amount (TZS)</span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-9 sm:text-sm"
            />
          </label>

          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}

          <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:justify-end">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              disabled={saving}
              className="min-h-[44px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:text-white disabled:opacity-50 sm:min-h-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
