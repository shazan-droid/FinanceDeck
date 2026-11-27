export type TabKey = 'overview' | 'working-capital' | 'long-term' | 'investments' | 'khums-tax' | 'admin';

export type KhumsMethod = 'wealth' | 'income_flow';
export type TraEmploymentMode = 'resident_primary' | 'resident_secondary' | 'non_resident';
export type TraPayFrequency = 'monthly' | 'annual';

export interface KhumsTaxConfig {
  // Khums (Ayatollah al-Sistani)
  khumsYearDate: string;
  khumsMethod: KhumsMethod;
  khumsBankCash: number;
  khumsHandCash: number;
  khumsPortfolioValue: number;
  khumsConsumablesValue: number;
  khumsReceivables: number;
  khumsPriorPaidBasis: number;
  khumsExemptReceipts: number;
  khumsMaunahDebt: number;
  khumsAnnualNetIncome: number;
  khumsAnnualMaunahExpense: number;

  // Tanzania TRA Taxes
  traPayFrequency: TraPayFrequency;
  traEmploymentMode: TraEmploymentMode;
  traGrossPay: number;
  traNssfRatePct: number;
  traSecondaryIncomeAnnual: number;
  traDseDividendsAnnual: number;
  traUnlistedDividendsAnnual: number;
  traDseCapitalGainsAnnual: number;
  traDseBelow25Pct: boolean;
  traUnlistedCapitalGainsAnnual: number;
  traRentalInterestAnnual: number;
}

export type BalanceSection =
  | 'current_asset'
  | 'current_liability'
  | 'longterm_asset'
  | 'longterm_liability';

export type BalanceType =
  | 'Cash in bank'
  | 'Cash in hand'
  | 'Receivable'
  | 'Payable'
  | 'Property'
  | 'Loan'
  | 'Other';

export const BANK_OPTIONS = ['Selcom', 'Stanbic', 'Tigo Pesa'] as const;
export type BankOption = (typeof BANK_OPTIONS)[number];

export type TransactionActivity = 'operating' | 'investing' | 'financing';

export type HoldingKind = 'DSE Stock' | 'ETF' | 'Bond' | 'Fund' | 'Stock' | 'Other';

export type PriceSource =
  | 'DSE'
  | 'UTT AMIS'
  | 'Fixed'
  | 'Yahoo'
  | 'StockAnalysis'
  | 'Investing.com'
  | 'Web'
  | 'Manual';

export interface BalanceEntry {
  id: number;
  section: BalanceSection;
  name: string;
  amount: number;
  date: string;
  type: BalanceType;
}

export interface TransactionEntry {
  id: number;
  date: string;
  activity: TransactionActivity;
  category: string;
  description: string;
  amount: number;
  receiptId?: string;
  receiptName?: string;
  receiptMime?: string;
}

export interface HoldingEntry {
  id: number;
  symbol: string;
  kind: HoldingKind;
  units: number;
  cost: number;
  price: number;
  updated: string;
  date: string;
  source: PriceSource;
  url: string;
  selector: string;
  regex: string;
}

export interface IndicatorEntry {
  id: number;
  name: string;
  url: string;
  selector: string;
  regex: string;
  value: string;
  updated: string;
}

export interface MonthlyFixedExpense {
  id: string;
  category: string;
  description: string;
  amount: number;
}

export const DEFAULT_FIXED_EXPENSE_TEMPLATE: MonthlyFixedExpense[] = [
  { id: 'rent', category: 'Rent', description: 'Rent', amount: 0 },
  { id: 'water', category: 'Utilities & data', description: 'Water', amount: 0 },
  { id: 'luku', category: 'Utilities & data', description: 'Luku', amount: 0 },
  { id: 'gym', category: 'Health', description: 'Gym', amount: 0 },
  { id: 'food', category: 'Food & groceries', description: 'Food + Fruits', amount: 0 },
  { id: 'wifi', category: 'Utilities & data', description: 'WiFi', amount: 0 },
  { id: 'maid', category: 'Other', description: 'Maid', amount: 0 },
];

export type AppLanguage = 'en' | 'sw';
export type PlanTier = 'free' | 'pro';
export type PaymentProvider =
  | 'none'
  | 'stripe'
  | 'mobile_money'
  | 'card_preview'
  | 'qr_whatsapp'
  | 'admin_manual';
export type PaymentClaimStatus = 'none' | 'pending_verification' | 'paid' | 'expired';

export interface SubscriptionInfo {
  plan: PlanTier;
  paidAmountUsd: number;
  paymentProvider: PaymentProvider;
  paymentRef: string;
  payerHint: string;
  paidAt: string;
  expiresAt?: string;
  daysRemaining?: number | null;
  claimStatus?: PaymentClaimStatus;
  claimUsername?: string;
  claimNote?: string;
  claimedAt?: string;
}

export interface BillingConfigResponse {
  priceUsd: number;
  priceTzsApprox: number;
  stripeConfigured: boolean;
  hasQrCode: boolean;
  qrUpdatedAt: string;
  paymentInstructions: string;
  whatsappNumber: string;
  plan: PlanTier;
  subscription: SubscriptionInfo;
}

export interface AdminUserRecord {
  email: string;
  uid: string;
  displayName: string;
  plan: PlanTier;
  paymentStatus: PaymentClaimStatus;
  paymentProvider: PaymentProvider;
  paymentRef: string;
  payerHint: string;
  claimUsername: string;
  claimNote: string;
  claimedAt: string;
  paidAt: string;
  expiresAt: string;
  daysRemaining: number | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface AppSettings {
  currency: 'TZS';
  language: AppLanguage;
  target: number;
  autoRefreshOnOpen: boolean;
  onboardingCompleted: boolean;
  khumsEnabled: boolean;
  monthlyFixedExpenses: MonthlyFixedExpense[];
  plan: PlanTier;
  subscription: SubscriptionInfo;
  isAdmin?: boolean;
}

export interface SnapshotMetrics {
  ca: number;
  cl: number;
  la: number;
  ll: number;
  port: number;
  wc: number;
  nw: number;
  bank: number;
  hand: number;
  stocks: number;
  bf: number;
}

export interface RunwayMetrics {
  burn: number;
  months: number | null;
}

export interface FinanceState {
  settings: AppSettings;
  balance: BalanceEntry[];
  transactions: TransactionEntry[];
  holdings: HoldingEntry[];
  indicators: IndicatorEntry[];
  snapshot: SnapshotMetrics;
  runway: RunwayMetrics;
  khumsTaxConfig?: Partial<KhumsTaxConfig>;
}

export interface RefreshPricesResponse {
  updatedCount: number;
  skippedFixedCount: number;
  failed: Array<{ symbol: string; reason: string }>;
  details: Array<{ symbol: string; price: number; source: string }>;
  message: string;
  state: FinanceState;
}

export const INCOME_CATEGORIES = [
  'Salary',
  'Business income',
  'Gifts received',
  'Investment income',
  'Other income',
  'Investment sale',
] as const;

export const EXPENSE_CATEGORIES = [
  'Rent',
  'Food & groceries',
  'Transport',
  'Utilities & data',
  'Education',
  'Health',
  'Charity',
  'Family support',
  'Loan repayment',
  'Investment purchase',
] as const;

export const TRANSACTION_CATEGORIES = [
  ...INCOME_CATEGORIES,
  ...EXPENSE_CATEGORIES,
  'Other',
] as const;

export const BALANCE_TYPES: BalanceType[] = [
  'Cash in bank',
  'Cash in hand',
  'Receivable',
  'Payable',
  'Property',
  'Loan',
  'Other',
];

export const HOLDING_KINDS: HoldingKind[] = [
  'DSE Stock',
  'ETF',
  'Bond',
  'Fund',
  'Stock',
  'Other',
];

export const PRICE_SOURCES: PriceSource[] = [
  'DSE',
  'UTT AMIS',
  'Yahoo',
  'StockAnalysis',
  'Fixed',
  'Web',
  'Manual',
];

export type StatementTargetSection =
  | 'cashflow'
  | 'current_asset'
  | 'current_liability'
  | 'longterm_asset'
  | 'longterm_liability'
  | 'holding';

export interface ParsedStatementItem {
  id: string;
  include: boolean;
  targetSection: StatementTargetSection;
  date: string;
  activity: TransactionActivity;
  direction: 'income' | 'expense';
  category: string;
  balanceType: BalanceType;
  description: string;
  originalDescription?: string;
  amount: number;
  holdingSymbol?: string;
  holdingKind?: HoldingKind;
  holdingUnits?: number;
  holdingCost?: number;
  holdingSource?: PriceSource;
  confidence?: 'high' | 'medium' | 'low';
  reason?: string;
  possibleDuplicate?: boolean;
}

export interface ParsedStatementResult {
  bankDetected: string;
  statementFrom: string;
  statementTo: string;
  closingBalance: { amount: number; date: string } | null;
  summary: string;
  items: ParsedStatementItem[];
}

