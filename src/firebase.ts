import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type {
  AppLanguage,
  BalanceEntry,
  FinanceState,
  HoldingEntry,
  IndicatorEntry,
  KhumsTaxConfig,
  MonthlyFixedExpense,
  PaymentProvider,
  PlanTier,
  SubscriptionInfo,
  TransactionEntry,
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: Array<{
      providerId?: string | null;
      email?: string | null;
    }>;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function isVerifiedUser(user: User | null): boolean {
  if (!user) return false;
  return user.emailVerified === true && Boolean(user.email);
}

export async function testFirestoreConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export async function syncUserProfile(
  user: User,
  preferredCurrency: 'TZS' = 'TZS'
): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    let exists = false;
    try {
      const snap = await getDocFromServer(ref);
      exists = snap.exists();
    } catch {
      exists = false;
    }

    const fallbackName = (user.email || 'Member').split('@')[0] || 'Member';
    const displayName = (user.displayName || fallbackName).slice(0, 120);
    if (!exists) {
      await setDoc(ref, {
        uid: user.uid,
        email: user.email || '',
        displayName,
        preferredCurrency,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        preferredCurrency,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

function clip(val: string | undefined | null, max: number): string {
  return String(val ?? '').slice(0, max);
}

export interface FirestoreRestoredLedger {
  hasData: boolean;
  holdings: HoldingEntry[];
  balances: BalanceEntry[];
  transactions: TransactionEntry[];
  indicators: IndicatorEntry[];
  settings?: {
    currency: 'TZS';
    language?: AppLanguage;
    target: number;
    autoRefreshOnOpen: boolean;
    onboardingCompleted?: boolean;
    khumsEnabled?: boolean;
    monthlyFixedExpenses?: MonthlyFixedExpense[];
    plan?: PlanTier;
    subscription?: SubscriptionInfo;
  };
  khumsTaxConfig?: Partial<KhumsTaxConfig>;
}

export async function loadStateFromFirestore(user: User): Promise<FirestoreRestoredLedger> {
  const uid = user.uid;
  const basePath = `users/${uid}`;

  const holdings: HoldingEntry[] = [];
  const balances: BalanceEntry[] = [];
  const transactions: TransactionEntry[] = [];
  const indicators: IndicatorEntry[] = [];
  let settings: FirestoreRestoredLedger['settings'];
  let khumsTaxConfig: Partial<KhumsTaxConfig> | undefined;

  try {
    const [holdSnap, balSnap, txSnap, indSnap] = await Promise.all([
      getDocs(query(collection(db, `${basePath}/holdings`), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, `${basePath}/balances`), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, `${basePath}/transactions`), where('ownerUid', '==', uid))),
      getDocs(query(collection(db, `${basePath}/indicators`), where('ownerUid', '==', uid))),
    ]);

    holdSnap.forEach((d) => {
      const x = d.data();
      holdings.push({
        id: Number(x.localId) || 0,
        symbol: String(x.symbol || ''),
        kind: x.kind,
        units: Number(x.units || 0),
        cost: Number(x.cost || 0),
        price: Number(x.price || 0),
        updated: String(x.updated || ''),
        date: String(x.date || ''),
        source: x.source,
        url: String(x.url || ''),
        selector: String(x.selector || ''),
        regex: String(x.regex || ''),
      });
    });

    balSnap.forEach((d) => {
      const x = d.data();
      balances.push({
        id: Number(x.localId) || 0,
        section: x.section,
        name: String(x.name || ''),
        amount: Number(x.amount || 0),
        date: String(x.date || ''),
        type: x.type,
      });
    });

    txSnap.forEach((d) => {
      const x = d.data();
      transactions.push({
        id: Number(x.localId) || 0,
        date: String(x.date || ''),
        activity: x.activity,
        category: String(x.category || ''),
        description: String(x.description || ''),
        amount: Number(x.amount || 0),
        receiptId: String(x.receiptId || ''),
        receiptName: String(x.receiptName || ''),
        receiptMime: String(x.receiptMime || ''),
      });
    });

    indSnap.forEach((d) => {
      const x = d.data();
      indicators.push({
        id: Number(x.localId) || 0,
        name: String(x.name || ''),
        url: String(x.url || ''),
        selector: String(x.selector || ''),
        regex: String(x.regex || ''),
        value: String(x.value || '-'),
        updated: String(x.updated || ''),
      });
    });

    let restoredSubscription: SubscriptionInfo | undefined;
    try {
      const subSnap = await getDocFromServer(doc(db, `${basePath}/appSettings`, 'subscription'));
      if (subSnap.exists()) {
        const s = subSnap.data();
        const providerRaw = String(s.paymentProvider || 'none');
        const paymentProvider: PaymentProvider =
          providerRaw === 'stripe' ||
          providerRaw === 'mobile_money' ||
          providerRaw === 'card_preview' ||
          providerRaw === 'qr_whatsapp' ||
          providerRaw === 'admin_manual'
            ? providerRaw
            : 'none';
        const plan: PlanTier =
          s.plan === 'pro' && Number(s.paidAmountUsd || 0) >= 5 && String(s.paymentRef || '').length >= 6
            ? 'pro'
            : 'free';
        restoredSubscription = {
          plan,
          paidAmountUsd: Number(s.paidAmountUsd || 0),
          paymentProvider,
          paymentRef: String(s.paymentRef || ''),
          payerHint: String(s.payerHint || ''),
          paidAt: String(s.paidAt || ''),
        };
      }
    } catch {
      // Optional subscription doc may not exist yet
    }

    try {
      const genSnap = await getDocFromServer(doc(db, `${basePath}/appSettings`, 'general'));
      if (genSnap.exists()) {
        const g = genSnap.data();
        const rawFixed = Array.isArray(g.monthlyFixedExpenses) ? g.monthlyFixedExpenses : [];
        const monthlyFixedExpenses: MonthlyFixedExpense[] = rawFixed
          .slice(0, 25)
          .map((item: unknown, idx: number) => {
            const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
            const description = clip(String(obj.description ?? ''), 120).trim();
            const category = clip(String(obj.category ?? 'Other'), 80).trim() || 'Other';
            const rawAmt = Number(obj.amount);
            return {
              id: clip(String(obj.id ?? `exp-${idx + 1}`), 64).trim() || `exp-${idx + 1}`,
              category,
              description,
              amount: Number.isFinite(rawAmt) && rawAmt >= 0 ? rawAmt : 0,
            };
          })
          .filter((item) => item.description.length > 0);

        settings = {
          currency: 'TZS',
          language: g.language === 'sw' ? 'sw' : 'en',
          target: Number(g.target) > 0 ? Number(g.target) : 100000000,
          autoRefreshOnOpen: Boolean(g.autoRefreshOnOpen ?? true),
          onboardingCompleted:
            typeof g.onboardingCompleted === 'boolean' ? g.onboardingCompleted : true,
          khumsEnabled: typeof g.khumsEnabled === 'boolean' ? g.khumsEnabled : true,
          monthlyFixedExpenses:
            monthlyFixedExpenses.length > 0 ? monthlyFixedExpenses : undefined,
          plan: restoredSubscription?.plan || 'free',
          subscription: restoredSubscription,
        };
      } else if (restoredSubscription) {
        settings = {
          currency: 'TZS',
          language: 'en',
          target: 100000000,
          autoRefreshOnOpen: true,
          onboardingCompleted: false,
          khumsEnabled: true,
          plan: restoredSubscription.plan,
          subscription: restoredSubscription,
        };
      }
    } catch {
      // Optional settings doc may not exist yet
    }

    try {
      const ktSnap = await getDocFromServer(doc(db, `${basePath}/appSettings`, 'khumsTax'));
      if (ktSnap.exists()) {
        const k = ktSnap.data();
        khumsTaxConfig = {
          khumsYearDate: String(k.khumsYearDate || ''),
          khumsMethod: k.khumsMethod,
          khumsBankCash: Number(k.khumsBankCash || 0),
          khumsHandCash: Number(k.khumsHandCash || 0),
          khumsPortfolioValue: Number(k.khumsPortfolioValue || 0),
          khumsConsumablesValue: Number(k.khumsConsumablesValue || 0),
          khumsReceivables: Number(k.khumsReceivables || 0),
          khumsPriorPaidBasis: Number(k.khumsPriorPaidBasis || 0),
          khumsExemptReceipts: Number(k.khumsExemptReceipts || 0),
          khumsMaunahDebt: Number(k.khumsMaunahDebt || 0),
          khumsAnnualNetIncome: Number(k.khumsAnnualNetIncome || 0),
          khumsAnnualMaunahExpense: Number(k.khumsAnnualMaunahExpense || 0),
          traPayFrequency: k.traPayFrequency,
          traEmploymentMode: k.traEmploymentMode,
          traGrossPay: Number(k.traGrossPay || 0),
          traNssfRatePct: Number(k.traNssfRatePct ?? 10),
          traSecondaryIncomeAnnual: Number(k.traSecondaryIncomeAnnual || 0),
          traDseDividendsAnnual: Number(k.traDseDividendsAnnual || 0),
          traUnlistedDividendsAnnual: Number(k.traUnlistedDividendsAnnual || 0),
          traDseCapitalGainsAnnual: Number(k.traDseCapitalGainsAnnual || 0),
          traDseBelow25Pct: Boolean(k.traDseBelow25Pct ?? true),
          traUnlistedCapitalGainsAnnual: Number(k.traUnlistedCapitalGainsAnnual || 0),
          traRentalInterestAnnual: Number(k.traRentalInterestAnnual || 0),
        };
      }
    } catch {
      // Optional khumsTax doc may not exist yet
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, basePath);
  }

  const hasData =
    holdings.some((h) => h.units > 0 && h.source !== 'Fixed') ||
    holdings.length > 9 ||
    balances.length > 0 ||
    transactions.length > 0 ||
    Boolean(khumsTaxConfig) ||
    Boolean(settings?.onboardingCompleted);

  return {
    hasData,
    holdings,
    balances,
    transactions,
    indicators,
    settings,
    khumsTaxConfig,
  };
}

export async function syncStateToFirestore(user: User, state: FinanceState): Promise<void> {
  const uid = user.uid;
  const basePath = `users/${uid}`;

  try {
    const syncCollection = async <T extends { id: number }>(
      subName: string,
      items: T[],
      toFields: (item: T) => Record<string, unknown>
    ) => {
      const colPath = `${basePath}/${subName}`;
      const snap = await getDocs(query(collection(db, colPath), where('ownerUid', '==', uid)));
      const existingIds = new Set<string>();
      snap.forEach((d) => existingIds.add(d.id));

      const targetIds = new Set<string>();
      for (const item of items) {
        const docId = String(item.id);
        targetIds.add(docId);
        const ref = doc(db, colPath, docId);
        const mutable = toFields(item);
        if (existingIds.has(docId)) {
          await updateDoc(ref, {
            ...mutable,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(ref, {
            ownerUid: uid,
            localId: item.id,
            ...mutable,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      for (const oldId of existingIds) {
        if (!targetIds.has(oldId)) {
          await deleteDoc(doc(db, colPath, oldId));
        }
      }
    };

    await syncCollection('holdings', state.holdings, (h) => ({
      symbol: clip(h.symbol, 120) || 'UNKNOWN',
      kind: clip(h.kind, 40) || 'DSE Stock',
      units: Math.max(0, Number(h.units) || 0),
      cost: Math.max(0, Number(h.cost) || 0),
      price: Math.max(0, Number(h.price) || 0),
      updated: clip(h.updated, 64),
      date: clip(h.date, 20),
      source: clip(h.source, 40) || 'DSE',
      url: clip(h.url, 500),
      selector: clip(h.selector, 200),
      regex: clip(h.regex, 200),
    }));

    await syncCollection('balances', state.balance, (b) => ({
      section: b.section,
      name: clip(b.name, 160) || 'Entry',
      amount: Number.isFinite(Number(b.amount)) ? Number(b.amount) : 0,
      date: clip(b.date, 20),
      type: clip(b.type, 40) || 'Other',
    }));

    await syncCollection('transactions', state.transactions, (t) => ({
      date: clip(t.date, 20),
      activity: t.activity,
      category: clip(t.category, 80) || 'Other',
      description: clip(t.description, 300),
      amount: Number.isFinite(Number(t.amount)) ? Number(t.amount) : 0,
      receiptId: clip(t.receiptId, 80).replace(/[^a-zA-Z0-9._-]/g, ''),
      receiptName: clip(t.receiptName, 200),
      receiptMime: clip(t.receiptMime, 80),
    }));

    await syncCollection('indicators', state.indicators, (ind) => ({
      name: clip(ind.name, 160) || 'Indicator',
      url: clip(ind.url, 500) || 'https://dse.co.tz',
      selector: clip(ind.selector, 200),
      regex: clip(ind.regex, 200),
      value: clip(ind.value, 80),
      updated: clip(ind.updated, 64),
    }));

    const genRef = doc(db, `${basePath}/appSettings`, 'general');
    let genExists = false;
    try {
      genExists = (await getDocFromServer(genRef)).exists();
    } catch {
      genExists = false;
    }
    const sanitizedFixed = (state.settings.monthlyFixedExpenses || [])
      .filter((item) => item && String(item.description || '').trim().length > 0)
      .slice(0, 25)
      .map((item, idx) => ({
        id: clip(item.id || `exp-${idx + 1}`, 64).trim() || `exp-${idx + 1}`,
        category: clip(item.category || 'Other', 80).trim() || 'Other',
        description: clip(item.description, 120).trim(),
        amount:
          Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0
            ? Number(item.amount)
            : 0,
      }));
    const genPayload = {
      currency: 'TZS' as const,
      language: state.settings.language === 'sw' ? 'sw' : 'en',
      target: Number(state.settings.target) > 0 ? Number(state.settings.target) : 100000000,
      autoRefreshOnOpen: Boolean(state.settings.autoRefreshOnOpen),
      onboardingCompleted: Boolean(state.settings.onboardingCompleted),
      khumsEnabled: Boolean(state.settings.khumsEnabled),
      monthlyFixedExpenses: sanitizedFixed,
    };
    if (genExists) {
      await updateDoc(genRef, { ...genPayload, updatedAt: serverTimestamp() });
    } else {
      await setDoc(genRef, {
        ownerUid: uid,
        ...genPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const subInfo = state.settings.subscription;
    if (subInfo) {
      const subRef = doc(db, `${basePath}/appSettings`, 'subscription');
      let subExists = false;
      let existingPlan = 'free';
      try {
        const subSnap = await getDocFromServer(subRef);
        subExists = subSnap.exists();
        if (subExists) {
          existingPlan = String(subSnap.data()?.plan || 'free');
        }
      } catch {
        subExists = false;
      }

      const subPayload = {
        plan: subInfo.plan === 'pro' ? 'pro' : 'free',
        paidAmountUsd: Number(subInfo.paidAmountUsd || 0),
        paymentProvider: subInfo.paymentProvider || 'none',
        paymentRef: clip(subInfo.paymentRef, 120),
        payerHint: clip(subInfo.payerHint, 80),
        paidAt: clip(subInfo.paidAt, 40),
      };

      if (!subExists) {
        await setDoc(subRef, {
          ownerUid: uid,
          ...subPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else if (existingPlan !== 'pro' && subPayload.plan === 'pro') {
        await updateDoc(subRef, { ...subPayload, updatedAt: serverTimestamp() });
      }
    }

    if (state.khumsTaxConfig) {
      const kt = state.khumsTaxConfig;
      const ktRef = doc(db, `${basePath}/appSettings`, 'khumsTax');
      let ktExists = false;
      try {
        ktExists = (await getDocFromServer(ktRef)).exists();
      } catch {
        ktExists = false;
      }
      const n = (v: unknown, max = 1e14) => {
        const x = Number(v);
        return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : 0;
      };
      const ktPayload = {
        khumsYearDate: clip(kt.khumsYearDate, 20),
        khumsMethod: kt.khumsMethod === 'income_flow' ? 'income_flow' : 'wealth',
        khumsBankCash: n(kt.khumsBankCash),
        khumsHandCash: n(kt.khumsHandCash),
        khumsPortfolioValue: n(kt.khumsPortfolioValue),
        khumsConsumablesValue: n(kt.khumsConsumablesValue),
        khumsReceivables: n(kt.khumsReceivables),
        khumsPriorPaidBasis: n(kt.khumsPriorPaidBasis),
        khumsExemptReceipts: n(kt.khumsExemptReceipts),
        khumsMaunahDebt: n(kt.khumsMaunahDebt),
        khumsAnnualNetIncome: n(kt.khumsAnnualNetIncome),
        khumsAnnualMaunahExpense: n(kt.khumsAnnualMaunahExpense),
        traPayFrequency: kt.traPayFrequency === 'annual' ? 'annual' : 'monthly',
        traEmploymentMode:
          kt.traEmploymentMode === 'resident_secondary' ||
          kt.traEmploymentMode === 'non_resident'
            ? kt.traEmploymentMode
            : 'resident_primary',
        traGrossPay: n(kt.traGrossPay),
        traNssfRatePct: n(kt.traNssfRatePct, 50),
        traSecondaryIncomeAnnual: n(kt.traSecondaryIncomeAnnual),
        traDseDividendsAnnual: n(kt.traDseDividendsAnnual),
        traUnlistedDividendsAnnual: n(kt.traUnlistedDividendsAnnual),
        traDseCapitalGainsAnnual: n(kt.traDseCapitalGainsAnnual),
        traDseBelow25Pct: typeof kt.traDseBelow25Pct === 'boolean' ? kt.traDseBelow25Pct : true,
        traUnlistedCapitalGainsAnnual: n(kt.traUnlistedCapitalGainsAnnual),
        traRentalInterestAnnual: n(kt.traRentalInterestAnnual),
      };
      if (ktExists) {
        await updateDoc(ktRef, { ...ktPayload, updatedAt: serverTimestamp() });
      } else {
        await setDoc(ktRef, {
          ownerUid: uid,
          ...ktPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, basePath);
  }
}

