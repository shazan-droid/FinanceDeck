import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Crown, Globe } from 'lucide-react';
import {
  DEFAULT_FIXED_EXPENSE_TEMPLATE,
  type AppLanguage,
  type FinanceState,
  type MonthlyFixedExpense,
  type PlanTier,
  type TransactionActivity,
} from '../types';
import { formatShillings, todayIso } from '../utils/format';
import { getTranslations } from '../utils/i18n';
import { FixedExpensesEditor } from './FixedExpensesEditor';

interface OnboardingSetupProps {
  userEmail: string;
  state: FinanceState;
  language: AppLanguage;
  onLanguageChange: (lang: AppLanguage) => Promise<void> | void;
  onCompleteOnboarding: (payload: {
    language: AppLanguage;
    target: number;
    khumsEnabled: boolean;
    monthlyFixedExpenses: MonthlyFixedExpense[];
    logToLedgerNow: boolean;
    openCheckoutAfterSave?: boolean;
  }) => Promise<void>;
  onSkipOnboarding: () => Promise<void>;
  onOpenUpgrade: () => void;
}

export function OnboardingSetup({
  userEmail,
  state,
  language,
  onLanguageChange,
  onCompleteOnboarding,
  onSkipOnboarding,
  onOpenUpgrade,
}: OnboardingSetupProps) {
  const t = getTranslations(language);
  const isAlreadyPro = state.settings.plan === 'pro';

  const [khumsEnabled, setKhumsEnabled] = useState<boolean>(state.settings.khumsEnabled);
  const [targetInput, setTargetInput] = useState<string>(
    String(state.settings.target > 0 ? state.settings.target : 100000000)
  );
  const [fixedExpenses, setFixedExpenses] = useState<MonthlyFixedExpense[]>(() => {
    const existing = state.settings.monthlyFixedExpenses;
    if (Array.isArray(existing) && existing.length > 0) {
      return existing.map((item) => ({ ...item }));
    }
    return DEFAULT_FIXED_EXPENSE_TEMPLATE.map((item) => ({ ...item }));
  });
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>(isAlreadyPro ? 'pro' : 'free');
  const [logToLedgerNow, setLogToLedgerNow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const cleanedExpenses = fixedExpenses
    .map((item, idx) => ({
      id: item.id || `exp-${idx + 1}`,
      category: item.category || 'Other',
      description: item.description.trim(),
      amount: Number.isFinite(item.amount) && item.amount >= 0 ? item.amount : 0,
    }))
    .filter((item) => item.description.length > 0);

  const filledExpenses = cleanedExpenses.filter((item) => item.amount > 0);
  const totalMonthlyFixed = filledExpenses.reduce((sum, item) => sum + item.amount, 0);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    const parsedTarget = Number(targetInput.replace(/,/g, '').trim());
    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      setError(
        language === 'sw'
          ? 'Weka Lengo la Thamani Halisi sahihi kwa TZS.'
          : 'Enter a valid positive Target Net Worth in TZS.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await onCompleteOnboarding({
        language,
        target: parsedTarget,
        khumsEnabled,
        monthlyFixedExpenses: cleanedExpenses,
        logToLedgerNow: logToLedgerNow && filledExpenses.length > 0,
        openCheckoutAfterSave: selectedPlan === 'pro' && !isAlreadyPro,
      });
    } catch (err) {
      setError((err as Error).message || 'Could not save onboarding setup.');
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    setError('');
    setSubmitting(true);
    try {
      await onSkipOnboarding();
    } catch (err) {
      setError((err as Error).message || 'Could not skip setup.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="mx-auto max-w-4xl space-y-5 sm:space-y-6">
      <div className="border-b border-[#242424] pb-4 sm:pb-5">
        <p className="truncate text-xs font-medium text-[#9A9A9A]">
          {t.setupTagline} · {userEmail || 'Personal Workspace'} · TZS
        </p>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          {t.setupTitle}
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-[#A0A0A0]">{t.setupSubtitle}</p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[#7F1D1D] bg-[#200A0C] px-4 py-3 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      {/* Section 1: Language Selection (English / Kiswahili) */}
      <section className="rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Globe className="h-4 w-4 text-[#C1121F]" />
              {t.setupLangHeading}
            </h2>
            <p className="mt-1 text-xs text-[#9A9A9A]">{t.setupLangDesc}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <button
              type="button"
              onClick={() => void onLanguageChange('en')}
              aria-pressed={language === 'en'}
              className={`min-h-[42px] rounded-md border px-4 py-2 text-xs font-semibold transition-colors sm:min-h-0 ${
                language === 'en'
                  ? 'border-[#C1121F] bg-[#C1121F] text-white'
                  : 'border-[#2C2C2C] bg-[#0B0B0B] text-[#CCCCCC] hover:border-[#C1121F] hover:text-white'
              }`}
            >
              {t.langEnglish}
            </button>
            <button
              type="button"
              onClick={() => void onLanguageChange('sw')}
              aria-pressed={language === 'sw'}
              className={`min-h-[42px] rounded-md border px-4 py-2 text-xs font-semibold transition-colors sm:min-h-0 ${
                language === 'sw'
                  ? 'border-[#C1121F] bg-[#C1121F] text-white'
                  : 'border-[#2C2C2C] bg-[#0B0B0B] text-[#CCCCCC] hover:border-[#C1121F] hover:text-white'
              }`}
            >
              {t.langSwahili}
            </button>
          </div>
        </div>
      </section>

      {/* Section 2: Khums Toggle & Net Worth Goal */}
      <section className="rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">{t.setupSec1Title}</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
          <div className="flex flex-col justify-between gap-4 rounded-md border border-[#242424] bg-[#0B0B0B] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-white">{t.khumsTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-[#9A9A9A]">
                  {khumsEnabled ? t.khumsEnabledDesc : t.khumsDisabledDesc}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={khumsEnabled}
                aria-label={t.khumsToggleLabel}
                onClick={() => setKhumsEnabled((prev) => !prev)}
                className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-[#C1121F] ${
                  khumsEnabled
                    ? 'border-[#C1121F] bg-[#C1121F]'
                    : 'border-[#333333] bg-[#1A1A1A]'
                }`}
              >
                <span
                  className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                    khumsEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            <div className="text-xs text-[#8A8A8A]">
              {t.statusLabel}{' '}
              <span className={khumsEnabled ? 'font-semibold text-emerald-400' : 'font-semibold text-[#D4D4D4]'}>
                {khumsEnabled ? t.khumsStatusOn : t.khumsStatusOff}
              </span>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-md border border-[#242424] bg-[#0B0B0B] p-4">
            <div>
              <label htmlFor="onboarding-target" className="block text-sm font-medium text-white">
                {t.targetLabel}
              </label>
              <p className="mt-1 text-xs text-[#9A9A9A]">{t.targetHint}</p>
            </div>
            <input
              id="onboarding-target"
              type="text"
              inputMode="decimal"
              value={targetInput}
              onChange={(e) => {
                const raw = e.target.value;
                if (!/^[0-9,]*\.?[0-9]*$/.test(raw)) return;
                setTargetInput(raw);
              }}
              placeholder="100000000"
              className="font-mono-nums h-11 w-full rounded-md border border-[#2A2A2A] bg-[#121212] px-3 text-base text-white focus:border-[#C1121F] focus:outline-none sm:h-10 sm:text-sm"
            />
          </div>
        </div>
      </section>

      {/* Section 3: List of Fixed Expenses */}
      <section className="rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">{t.setupSec2Title}</h2>
          <span className="font-mono-nums text-xs text-[#9A9A9A]">
            {t.annualized} {formatShillings(totalMonthlyFixed * 12, 'TZS', 0)} {t.perYear}
          </span>
        </div>

        <FixedExpensesEditor items={fixedExpenses} onChange={setFixedExpenses} />

        <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-3 text-xs text-[#CCCCCC]">
          <input
            type="checkbox"
            checked={logToLedgerNow}
            onChange={(e) => setLogToLedgerNow(e.target.checked)}
            disabled={filledExpenses.length === 0}
            className="h-4 w-4 shrink-0 accent-[#C1121F] disabled:opacity-40"
          />
          <span>
            {t.logToLedgerPrefix} {filledExpenses.length} ({todayIso()}) {t.logToLedgerSuffix}
          </span>
        </label>
      </section>

      {/* Section 4: Freemium Plan & $5 Pro Option */}
      <section className="rounded-lg border border-[#242424] bg-[#121212] p-4 sm:p-5">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-white">{t.setupSec3Title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#9A9A9A]">{t.setupPlanDesc}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <button
            type="button"
            disabled={isAlreadyPro}
            onClick={() => setSelectedPlan('free')}
            className={`flex flex-col justify-between gap-2 rounded-md border p-4 text-left transition-colors ${
              selectedPlan === 'free' && !isAlreadyPro
                ? 'border-[#C1121F] bg-[#19090B]'
                : 'border-[#262626] bg-[#0B0B0B] hover:border-[#3A3A3A]'
            } disabled:opacity-50`}
          >
            <div className="flex w-full items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-white">{t.planFreeTitle}</span>
              <span className="font-mono-nums text-lg font-bold text-white">{t.planFreePrice}</span>
            </div>
            <p className="text-xs leading-relaxed text-[#9A9A9A]">{t.planFreeDesc}</p>
          </button>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setSelectedPlan('pro')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedPlan('pro');
              }
            }}
            className={`flex cursor-pointer flex-col justify-between gap-3 rounded-md border p-4 text-left transition-colors ${
              selectedPlan === 'pro' || isAlreadyPro
                ? 'border-[#C1121F] bg-[#19090B]'
                : 'border-[#262626] bg-[#0B0B0B] hover:border-[#3A3A3A]'
            }`}
          >
            <div>
              <div className="flex w-full items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
                  <Crown className="h-4 w-4 text-[#C1121F]" />
                  {t.planProTitle}
                </span>
                <span className="font-mono-nums text-lg font-bold text-white">
                  {isAlreadyPro ? t.proBadge : t.planProPrice}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#B5B5B5]">{t.planProDesc}</p>
            </div>
            {!isAlreadyPro && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPlan('pro');
                  onOpenUpgrade();
                }}
                className="inline-flex min-h-[38px] items-center justify-center rounded-md border border-[#C1121F] bg-[#0B0B0B] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#C1121F]"
              >
                {t.payNowBtn}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex flex-col-reverse gap-3 border-t border-[#242424] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void handleSkip()}
          disabled={submitting}
          className="min-h-[44px] w-full rounded-md border border-[#2C2C2C] px-4 py-2.5 text-xs font-medium text-[#BDBDBD] transition-colors hover:border-[#C1121F] hover:text-white disabled:opacity-50 sm:w-auto"
        >
          {t.skipForNow}
        </button>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#C1121F] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-[44px] sm:w-auto"
        >
          <Check className="h-4 w-4" />
          {submitting
            ? t.savingSetup
            : selectedPlan === 'pro' && !isAlreadyPro
              ? t.planSelectedProCta
              : t.completeSetup}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}

export type OnboardingBatchItem = {
  date: string;
  activity: TransactionActivity;
  category: string;
  description: string;
  amount: number;
};
