import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  DEFAULT_FIXED_EXPENSE_TEMPLATE,
  EXPENSE_CATEGORIES,
  type MonthlyFixedExpense,
} from '../types';
import { formatShillings } from '../utils/format';

interface FixedExpensesEditorProps {
  items: MonthlyFixedExpense[];
  onChange: (next: MonthlyFixedExpense[]) => void;
}

const FIXED_EXPENSE_CATEGORIES = [...EXPENSE_CATEGORIES, 'Other'] as const;

export function FixedExpensesEditor({ items, onChange }: FixedExpensesEditorProps) {
  const totalAmount = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.amount) && item.amount > 0 ? item.amount : 0),
    0
  );
  const filledCount = items.filter(
    (item) => item.description.trim().length > 0 && item.amount > 0
  ).length;

  const updateRow = (idx: number, patch: Partial<MonthlyFixedExpense>) => {
    const next = items.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    onChange(next);
  };

  const removeRow = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    if (items.length >= 25) return;
    onChange([
      ...items,
      {
        id: `custom-${Date.now().toString(36)}-${items.length + 1}`,
        category: 'Other',
        description: '',
        amount: 0,
      },
    ]);
  };

  const restoreTemplate = () => {
    onChange(DEFAULT_FIXED_EXPENSE_TEMPLATE.map((t) => ({ ...t })));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-xs text-[#9A9A9A]">
          Enter your recurring monthly amounts in TZS. Leave any unused item at 0 or remove it.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            type="button"
            onClick={restoreTemplate}
            className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-3 py-1.5 text-xs font-medium text-[#BDBDBD] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0"
          >
            <RotateCcw className="h-3 w-3" />
            Reset List
          </button>
          <button
            type="button"
            onClick={addRow}
            disabled={items.length >= 25}
            className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] bg-[#0B0B0B] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-[#C1121F] disabled:opacity-40 sm:min-h-0"
          >
            <Plus className="h-3.5 w-3.5 text-[#C1121F]" />
            Add Expense Item
          </button>
        </div>
      </div>

      {/* Mobile stacked rows */}
      <div className="space-y-2.5 md:hidden">
        {items.length === 0 ? (
          <div className="rounded-md border border-[#242424] bg-[#0B0B0B] px-4 py-6 text-center text-xs text-[#8A8A8A]">
            No fixed expense rows yet. Tap &ldquo;Add Expense Item&rdquo; or &ldquo;Reset List&rdquo;.
          </div>
        ) : (
          items.map((row, idx) => (
            <div
              key={row.id}
              className="space-y-2 rounded-md border border-[#242424] bg-[#0B0B0B] p-3"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono-nums w-5 shrink-0 text-xs text-[#787878]">
                  {idx + 1}.
                </span>
                <input
                  type="text"
                  value={row.description}
                  maxLength={120}
                  onChange={(e) => updateRow(idx, { description: e.target.value })}
                  placeholder="Expense name (e.g., Rent)"
                  className="h-10 min-w-0 flex-1 rounded border border-[#262626] bg-[#121212] px-3 text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  aria-label={`Remove ${row.description || 'expense row'}`}
                  className="flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded border border-[#242424] text-[#8A8A8A] transition-colors hover:bg-[#2A0A0D] hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 pl-7">
                <select
                  value={row.category}
                  onChange={(e) => updateRow(idx, { category: e.target.value })}
                  aria-label="Category"
                  className="h-10 w-full rounded border border-[#262626] bg-[#121212] px-2.5 text-base text-[#E5E5E5] focus:border-[#C1121F] focus:outline-none"
                >
                  {FIXED_EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.amount > 0 ? String(row.amount) : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/,/g, '');
                    if (raw === '') {
                      updateRow(idx, { amount: 0 });
                      return;
                    }
                    if (!/^\d*\.?\d*$/.test(raw)) return;
                    const num = Number(raw);
                    if (Number.isFinite(num) && num >= 0) {
                      updateRow(idx, { amount: Math.min(num, 1e14) });
                    }
                  }}
                  placeholder="Amount (TZS)"
                  aria-label="Monthly amount in TZS"
                  className="font-mono-nums h-10 w-full rounded border border-[#262626] bg-[#121212] px-3 text-right text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none"
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-md border border-[#242424] bg-[#0B0B0B] md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[#222222] bg-[#101010] text-xs font-semibold text-[#9A9A9A]">
              <th className="w-10 px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">Expense Name</th>
              <th className="w-44 px-3 py-2.5">Category</th>
              <th className="w-44 px-3 py-2.5 text-right">Monthly Amount (TZS)</th>
              <th className="w-12 px-3 py-2.5 text-right">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1B1B1B]">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-xs text-[#8A8A8A]">
                  No fixed expense rows yet. Click &ldquo;Add Expense Item&rdquo; or &ldquo;Reset List&rdquo;.
                </td>
              </tr>
            ) : (
              items.map((row, idx) => (
                <tr key={row.id} className="hover:bg-[#131313]">
                  <td className="font-mono-nums px-3 py-2 text-xs text-[#787878]">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.description}
                      maxLength={120}
                      onChange={(e) => updateRow(idx, { description: e.target.value })}
                      placeholder="e.g., Rent, Water, Transport..."
                      className="h-8 w-full rounded border border-[#262626] bg-[#121212] px-2.5 text-xs text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.category}
                      onChange={(e) => updateRow(idx, { category: e.target.value })}
                      className="h-8 w-full rounded border border-[#262626] bg-[#121212] px-2 text-xs text-[#E5E5E5] focus:border-[#C1121F] focus:outline-none"
                    >
                      {FIXED_EXPENSE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.amount > 0 ? String(row.amount) : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/,/g, '');
                        if (raw === '') {
                          updateRow(idx, { amount: 0 });
                          return;
                        }
                        if (!/^\d*\.?\d*$/.test(raw)) return;
                        const num = Number(raw);
                        if (Number.isFinite(num) && num >= 0) {
                          updateRow(idx, { amount: Math.min(num, 1e14) });
                        }
                      }}
                      placeholder="0"
                      className="font-mono-nums h-8 w-full rounded border border-[#262626] bg-[#121212] px-2.5 text-right text-xs text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      aria-label={`Remove ${row.description || 'expense row'}`}
                      className="rounded p-1.5 text-[#7A7A7A] transition-colors hover:bg-[#2A0A0D] hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#222222] pt-2.5 text-xs">
        <span className="text-[#8A8A8A]">
          {filledCount} active {filledCount === 1 ? 'item' : 'items'} with amount &gt; 0 · Used by the{' '}
          <span className="font-medium text-[#D4D4D4]">Monthly Default</span> action
        </span>
        <span className="font-mono-nums font-semibold text-white">
          Total: {formatShillings(totalAmount, 'TZS', 0)} / month
        </span>
      </div>
    </div>
  );
}
