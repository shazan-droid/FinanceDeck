import type {
  FinanceState,
  KhumsTaxConfig,
  TraEmploymentMode,
} from '../types';
import { todayIso } from './format';

export interface KhumsBreakdown {
  method: 'wealth' | 'income_flow';
  grossBase: number;
  totalDeductions: number;
  netSurplus: number;
  rawSurplus: number;
  totalKhums: number;
  sahmAlImam: number;
  sahmAlSadat: number;
  retainedAfterKhums: number;
  items: Array<{ label: string; amount: number; sign: '+' | '-' | '=' }>;
}

export interface PayeBracketRow {
  label: string;
  rangeLabel: string;
  ratePct: number;
  taxableInBand: number;
  monthlyTax: number;
  annualTax: number;
}

export interface TanzaniaTaxBreakdown {
  grossMonthlyPay: number;
  grossAnnualPay: number;
  monthlyNssfDeduction: number;
  annualNssfDeduction: number;
  monthlyTaxableEmployment: number;
  annualTaxableEmployment: number;
  monthlyPaye: number;
  annualPaye: number;
  netMonthlyTakeHome: number;
  netAnnualTakeHome: number;
  marginalRatePct: number;
  payeBrackets: PayeBracketRow[];

  secondaryIncomeTax: number;
  dseDividendTax: number;
  unlistedDividendTax: number;
  dseCapitalGainsTax: number;
  unlistedCapitalGainsTax: number;
  rentalInterestTax: number;

  totalInvestmentAndOtherTax: number;
  totalAnnualTaxLiability: number;
  totalGrossAnnualIncome: number;
  totalAnnualNetAfterTax: number;
  effectiveTaxRatePct: number;
}

export function createDefaultKhumsTaxConfig(): KhumsTaxConfig {
  return {
    khumsYearDate: todayIso(),
    khumsMethod: 'wealth',
    khumsBankCash: 0,
    khumsHandCash: 0,
    khumsPortfolioValue: 0,
    khumsConsumablesValue: 0,
    khumsReceivables: 0,
    khumsPriorPaidBasis: 0,
    khumsExemptReceipts: 0,
    khumsMaunahDebt: 0,
    khumsAnnualNetIncome: 0,
    khumsAnnualMaunahExpense: 0,

    traPayFrequency: 'monthly',
    traEmploymentMode: 'resident_primary',
    traGrossPay: 0,
    traNssfRatePct: 10,
    traSecondaryIncomeAnnual: 0,
    traDseDividendsAnnual: 0,
    traUnlistedDividendsAnnual: 0,
    traDseCapitalGainsAnnual: 0,
    traDseBelow25Pct: true,
    traUnlistedCapitalGainsAnnual: 0,
    traRentalInterestAnnual: 0,
  };
}

export function mergeKhumsTaxConfig(saved?: Partial<KhumsTaxConfig>): KhumsTaxConfig {
  const def = createDefaultKhumsTaxConfig();
  if (!saved) return def;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    khumsYearDate:
      typeof saved.khumsYearDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.khumsYearDate)
        ? saved.khumsYearDate
        : def.khumsYearDate,
    khumsMethod: saved.khumsMethod === 'income_flow' ? 'income_flow' : 'wealth',
    khumsBankCash: num(saved.khumsBankCash, def.khumsBankCash),
    khumsHandCash: num(saved.khumsHandCash, def.khumsHandCash),
    khumsPortfolioValue: num(saved.khumsPortfolioValue, def.khumsPortfolioValue),
    khumsConsumablesValue: num(saved.khumsConsumablesValue, def.khumsConsumablesValue),
    khumsReceivables: num(saved.khumsReceivables, def.khumsReceivables),
    khumsPriorPaidBasis: num(saved.khumsPriorPaidBasis, def.khumsPriorPaidBasis),
    khumsExemptReceipts: num(saved.khumsExemptReceipts, def.khumsExemptReceipts),
    khumsMaunahDebt: num(saved.khumsMaunahDebt, def.khumsMaunahDebt),
    khumsAnnualNetIncome: num(saved.khumsAnnualNetIncome, def.khumsAnnualNetIncome),
    khumsAnnualMaunahExpense: num(saved.khumsAnnualMaunahExpense, def.khumsAnnualMaunahExpense),

    traPayFrequency: saved.traPayFrequency === 'annual' ? 'annual' : 'monthly',
    traEmploymentMode:
      saved.traEmploymentMode === 'resident_secondary' || saved.traEmploymentMode === 'non_resident'
        ? saved.traEmploymentMode
        : 'resident_primary',
    traGrossPay: num(saved.traGrossPay, def.traGrossPay),
    traNssfRatePct: num(saved.traNssfRatePct, def.traNssfRatePct),
    traSecondaryIncomeAnnual: num(saved.traSecondaryIncomeAnnual, def.traSecondaryIncomeAnnual),
    traDseDividendsAnnual: num(saved.traDseDividendsAnnual, def.traDseDividendsAnnual),
    traUnlistedDividendsAnnual: num(saved.traUnlistedDividendsAnnual, def.traUnlistedDividendsAnnual),
    traDseCapitalGainsAnnual: num(saved.traDseCapitalGainsAnnual, def.traDseCapitalGainsAnnual),
    traDseBelow25Pct:
      typeof saved.traDseBelow25Pct === 'boolean' ? saved.traDseBelow25Pct : def.traDseBelow25Pct,
    traUnlistedCapitalGainsAnnual: num(
      saved.traUnlistedCapitalGainsAnnual,
      def.traUnlistedCapitalGainsAnnual
    ),
    traRentalInterestAnnual: num(saved.traRentalInterestAnnual, def.traRentalInterestAnnual),
  };
}

export function buildPrefillFromState(
  current: KhumsTaxConfig,
  state: FinanceState
): KhumsTaxConfig {
  const { snapshot, balance, transactions } = state;

  const receivables = balance
    .filter((b) => b.section === 'current_asset' && b.type === 'Receivable')
    .reduce((acc, b) => acc + Number(b.amount || 0), 0);

  const currentPayables = balance
    .filter((b) => b.section === 'current_liability' && b.type === 'Payable')
    .reduce((acc, b) => acc + Number(b.amount || 0), 0);

  // Rolling 365-day operating flows for annual income / ma'unah estimate
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const ops365 = transactions.filter(
    (t) => t.activity === 'operating' && t.date >= cutoffIso
  );

  let annualOpIncome = 0;
  let annualOpExpense = 0;
  let salaryAnnual = 0;
  let dividendsAnnual = 0;

  for (const t of ops365) {
    if (t.amount > 0) {
      annualOpIncome += t.amount;
      if (t.category === 'Salary') salaryAnnual += t.amount;
      if (t.category === 'Investment income') dividendsAnnual += t.amount;
    } else if (t.amount < 0) {
      annualOpExpense += Math.abs(t.amount);
    }
  }

  return {
    ...current,
    khumsBankCash: Math.max(0, Math.round(snapshot.bank)),
    khumsHandCash: Math.max(0, Math.round(snapshot.hand)),
    khumsPortfolioValue: Math.max(0, Math.round(snapshot.port)),
    khumsReceivables: Math.max(0, Math.round(receivables)),
    khumsMaunahDebt: Math.max(0, Math.round(currentPayables)),
    khumsAnnualNetIncome:
      annualOpIncome > 0 ? Math.round(annualOpIncome) : current.khumsAnnualNetIncome,
    khumsAnnualMaunahExpense:
      annualOpExpense > 0 ? Math.round(annualOpExpense) : current.khumsAnnualMaunahExpense,
    traGrossPay:
      salaryAnnual > 0
        ? current.traPayFrequency === 'annual'
          ? Math.round(salaryAnnual)
          : Math.round(salaryAnnual / 12)
        : current.traGrossPay,
    traDseDividendsAnnual:
      dividendsAnnual > 0 ? Math.round(dividendsAnnual) : current.traDseDividendsAnnual,
  };
}

/**
 * Ayatollah Sayyid Ali al-Sistani Khums Calculation (20% of annual net surplus)
 */
export function calculateSistaniKhums(cfg: KhumsTaxConfig): KhumsBreakdown {
  if (cfg.khumsMethod === 'income_flow') {
    const grossBase = Math.max(0, cfg.khumsAnnualNetIncome);
    const maunah = Math.max(0, cfg.khumsAnnualMaunahExpense);
    const priorAndExempt =
      Math.max(0, cfg.khumsPriorPaidBasis) + Math.max(0, cfg.khumsExemptReceipts);
    const totalDeductions = maunah + priorAndExempt;
    const rawSurplus = grossBase - totalDeductions;
    const netSurplus = Math.max(0, rawSurplus);
    const totalKhums = netSurplus * 0.2;
    const sahmAlImam = totalKhums * 0.5;
    const sahmAlSadat = totalKhums * 0.5;

    return {
      method: 'income_flow',
      grossBase,
      totalDeductions,
      rawSurplus,
      netSurplus,
      totalKhums,
      sahmAlImam,
      sahmAlSadat,
      retainedAfterKhums: netSurplus - totalKhums,
      items: [
        { label: 'Annual Net Earnings (After Tax)', amount: grossBase, sign: '+' },
        { label: "Annual Ma'unah (Living Expenses)", amount: maunah, sign: '-' },
        { label: 'Previously Khumsed / Exempt Receipts', amount: priorAndExempt, sign: '-' },
        { label: 'Net Khumsable Annual Surplus', amount: netSurplus, sign: '=' },
      ],
    };
  }

  const bank = Math.max(0, cfg.khumsBankCash);
  const hand = Math.max(0, cfg.khumsHandCash);
  const port = Math.max(0, cfg.khumsPortfolioValue);
  const consumables = Math.max(0, cfg.khumsConsumablesValue);
  const receivables = Math.max(0, cfg.khumsReceivables);
  const grossBase = bank + hand + port + consumables + receivables;

  const priorPaid = Math.max(0, cfg.khumsPriorPaidBasis);
  const exempt = Math.max(0, cfg.khumsExemptReceipts);
  const maunahDebt = Math.max(0, cfg.khumsMaunahDebt);
  const totalDeductions = priorPaid + exempt + maunahDebt;

  const rawSurplus = grossBase - totalDeductions;
  const netSurplus = Math.max(0, rawSurplus);
  const totalKhums = netSurplus * 0.2;
  const sahmAlImam = totalKhums * 0.5;
  const sahmAlSadat = totalKhums * 0.5;

  return {
    method: 'wealth',
    grossBase,
    totalDeductions,
    rawSurplus,
    netSurplus,
    totalKhums,
    sahmAlImam,
    sahmAlSadat,
    retainedAfterKhums: netSurplus - totalKhums,
    items: [
      { label: 'Cash in Bank (Selcom / Stanbic / Tigo Pesa)', amount: bank, sign: '+' },
      { label: 'Cash in Hand', amount: hand, sign: '+' },
      { label: 'Stocks, ETFs & UTT AMIS Funds (Market Value)', amount: port, sign: '+' },
      { label: 'Unconsumed Household Supplies', amount: consumables, sign: '+' },
      { label: 'Collectible Earnings Receivables', amount: receivables, sign: '+' },
      { label: 'Prior Khums-Paid Capital Basis', amount: priorPaid, sign: '-' },
      { label: 'Exempt Receipts (Inheritance / Mahr / Exempt Gifts)', amount: exempt, sign: '-' },
      { label: "Unpaid Current-Year Ma'unah Debts", amount: maunahDebt, sign: '-' },
      { label: 'Net Khumsable Surplus', amount: netSurplus, sign: '=' },
    ],
  };
}

const TRA_RESIDENT_MONTHLY_BANDS: Array<{
  label: string;
  rangeLabel: string;
  lower: number;
  upper: number;
  rate: number;
}> = [
  { label: 'Band 1 (Tax-Free)', rangeLabel: '0 – 270,000', lower: 0, upper: 270000, rate: 0 },
  {
    label: 'Band 2 (8%)',
    rangeLabel: '270,001 – 520,000',
    lower: 270000,
    upper: 520000,
    rate: 0.08,
  },
  {
    label: 'Band 3 (20%)',
    rangeLabel: '520,001 – 760,000',
    lower: 520000,
    upper: 760000,
    rate: 0.2,
  },
  {
    label: 'Band 4 (25%)',
    rangeLabel: '760,001 – 1,000,000',
    lower: 760000,
    upper: 1000000,
    rate: 0.25,
  },
  {
    label: 'Band 5 (30%)',
    rangeLabel: 'Above 1,000,000',
    lower: 1000000,
    upper: Infinity,
    rate: 0.3,
  },
];

export function computeMonthlyTraPaye(
  monthlyTaxableIncome: number,
  mode: TraEmploymentMode
): { monthlyPaye: number; marginalRatePct: number; brackets: PayeBracketRow[] } {
  const taxable = Math.max(0, monthlyTaxableIncome);

  if (mode === 'resident_secondary') {
    const monthlyPaye = taxable * 0.3;
    return {
      monthlyPaye,
      marginalRatePct: taxable > 0 ? 30 : 0,
      brackets: [
        {
          label: 'Secondary Employment',
          rangeLabel: 'Flat 30% at source',
          ratePct: 30,
          taxableInBand: taxable,
          monthlyTax: monthlyPaye,
          annualTax: monthlyPaye * 12,
        },
      ],
    };
  }

  if (mode === 'non_resident') {
    const monthlyPaye = taxable * 0.15;
    return {
      monthlyPaye,
      marginalRatePct: taxable > 0 ? 15 : 0,
      brackets: [
        {
          label: 'Non-Resident Employment',
          rangeLabel: 'Flat 15% WHT',
          ratePct: 15,
          taxableInBand: taxable,
          monthlyTax: monthlyPaye,
          annualTax: monthlyPaye * 12,
        },
      ],
    };
  }

  let monthlyPaye = 0;
  let marginalRatePct = 0;
  const brackets: PayeBracketRow[] = TRA_RESIDENT_MONTHLY_BANDS.map((band) => {
    const slice = Math.max(0, Math.min(taxable, band.upper) - band.lower);
    const tax = slice * band.rate;
    monthlyPaye += tax;
    if (taxable > band.lower) {
      marginalRatePct = band.rate * 100;
    }
    return {
      label: band.label,
      rangeLabel: band.rangeLabel,
      ratePct: band.rate * 100,
      taxableInBand: slice,
      monthlyTax: tax,
      annualTax: tax * 12,
    };
  });

  return { monthlyPaye, marginalRatePct, brackets };
}

/**
 * Tanzania Revenue Authority (TRA) Personal & Investment Tax Calculation (TZS)
 */
export function calculateTanzaniaTaxes(cfg: KhumsTaxConfig): TanzaniaTaxBreakdown {
  const grossMonthlyPay =
    cfg.traPayFrequency === 'annual'
      ? Math.max(0, cfg.traGrossPay) / 12
      : Math.max(0, cfg.traGrossPay);
  const grossAnnualPay = grossMonthlyPay * 12;

  const nssfPct =
    cfg.traEmploymentMode === 'non_resident'
      ? 0
      : Math.max(0, Math.min(50, cfg.traNssfRatePct));

  const monthlyNssfDeduction = grossMonthlyPay * (nssfPct / 100);
  const annualNssfDeduction = monthlyNssfDeduction * 12;

  const monthlyTaxableEmployment = Math.max(0, grossMonthlyPay - monthlyNssfDeduction);
  const annualTaxableEmployment = monthlyTaxableEmployment * 12;

  const { monthlyPaye, marginalRatePct, brackets } = computeMonthlyTraPaye(
    monthlyTaxableEmployment,
    cfg.traEmploymentMode
  );
  const annualPaye = monthlyPaye * 12;

  const netMonthlyTakeHome = Math.max(0, grossMonthlyPay - monthlyNssfDeduction - monthlyPaye);
  const netAnnualTakeHome = netMonthlyTakeHome * 12;

  const secondaryIncomeAnnual = Math.max(0, cfg.traSecondaryIncomeAnnual);
  const dseDividendsAnnual = Math.max(0, cfg.traDseDividendsAnnual);
  const unlistedDividendsAnnual = Math.max(0, cfg.traUnlistedDividendsAnnual);
  const dseCgtAnnual = Math.max(0, cfg.traDseCapitalGainsAnnual);
  const unlistedCgtAnnual = Math.max(0, cfg.traUnlistedCapitalGainsAnnual);
  const rentalInterestAnnual = Math.max(0, cfg.traRentalInterestAnnual);

  const secondaryIncomeTax = secondaryIncomeAnnual * 0.3;
  const dseDividendTax = dseDividendsAnnual * 0.05;
  const unlistedDividendTax = unlistedDividendsAnnual * 0.1;
  const dseCapitalGainsTax = cfg.traDseBelow25Pct ? 0 : dseCgtAnnual * 0.1;
  const unlistedCapitalGainsTax = unlistedCgtAnnual * 0.1;
  const rentalInterestTax = rentalInterestAnnual * 0.1;

  const totalInvestmentAndOtherTax =
    secondaryIncomeTax +
    dseDividendTax +
    unlistedDividendTax +
    dseCapitalGainsTax +
    unlistedCapitalGainsTax +
    rentalInterestTax;

  const totalAnnualTaxLiability = annualPaye + totalInvestmentAndOtherTax;

  const totalGrossAnnualIncome =
    grossAnnualPay +
    secondaryIncomeAnnual +
    dseDividendsAnnual +
    unlistedDividendsAnnual +
    dseCgtAnnual +
    unlistedCgtAnnual +
    rentalInterestAnnual;

  const totalAnnualNetAfterTax = Math.max(
    0,
    totalGrossAnnualIncome - annualNssfDeduction - totalAnnualTaxLiability
  );

  const effectiveTaxRatePct =
    totalGrossAnnualIncome > 0 ? (totalAnnualTaxLiability / totalGrossAnnualIncome) * 100 : 0;

  return {
    grossMonthlyPay,
    grossAnnualPay,
    monthlyNssfDeduction,
    annualNssfDeduction,
    monthlyTaxableEmployment,
    annualTaxableEmployment,
    monthlyPaye,
    annualPaye,
    netMonthlyTakeHome,
    netAnnualTakeHome,
    marginalRatePct,
    payeBrackets: brackets,

    secondaryIncomeTax,
    dseDividendTax,
    unlistedDividendTax,
    dseCapitalGainsTax,
    unlistedCapitalGainsTax,
    rentalInterestTax,

    totalInvestmentAndOtherTax,
    totalAnnualTaxLiability,
    totalGrossAnnualIncome,
    totalAnnualNetAfterTax,
    effectiveTaxRatePct,
  };
}
