import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  Calculator,
  Clock,
  Crown,
  Landmark,
  LayoutDashboard,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { AdminTab } from './components/AdminTab';
import { BankStatementImportModal } from './components/BankStatementImportModal';
import { InvestmentsTab } from './components/InvestmentsTab';
import { KhumsTaxTab } from './components/KhumsTaxTab';
import { LongTermTab } from './components/LongTermTab';
import { OnboardingSetup } from './components/OnboardingSetup';
import { OverviewTab } from './components/OverviewTab';
import { UpgradeModal, type LockedFeatureKey } from './components/UpgradeModal';
import { WorkingCapitalTab } from './components/WorkingCapitalTab';
import {
  auth,
  googleProvider,
  isVerifiedUser,
  loadStateFromFirestore,
  syncStateToFirestore,
  syncUserProfile,
  testFirestoreConnection,
} from './firebase';
import type {
  AdminUserRecord,
  AppLanguage,
  BalanceSection,
  BalanceType,
  BillingConfigResponse,
  FinanceState,
  HoldingKind,
  KhumsTaxConfig,
  MonthlyFixedExpense,
  ParsedStatementItem,
  ParsedStatementResult,
  PlanTier,
  PriceSource,
  RefreshPricesResponse,
  TabKey,
  TransactionActivity,
} from './types';
import { firstDayOfMonthIso, todayIso } from './utils/format';
import { getTranslations } from './utils/i18n';

const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const INACTIVITY_WARNING_MS = 60 * 1000;
const LANG_STORAGE_KEY = 'financedesk:preferredLanguage';

function readStoredLanguage(): AppLanguage {
  try {
    return window.localStorage.getItem(LANG_STORAGE_KEY) === 'sw' ? 'sw' : 'en';
  } catch {
    return 'en';
  }
}

function writeStoredLanguage(lang: AppLanguage): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Ignore storage errors
  }
}

function getActivityStorageKey(uid: string): string {
  return `financedesk:lastActivity:${uid}`;
}

function readStoredActivity(uid: string): number | null {
  try {
    const raw = window.localStorage.getItem(getActivityStorageKey(uid));
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredActivity(uid: string, timestamp: number): void {
  try {
    window.localStorage.setItem(getActivityStorageKey(uid), String(timestamp));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

function clearStoredActivity(uid?: string | null): void {
  if (!uid) return;
  try {
    window.localStorage.removeItem(getActivityStorageKey(uid));
  } catch {
    // Ignore storage errors
  }
}

function isFreshSeededState(s: FinanceState): boolean {
  const hasInvestedLiveHolding = s.holdings.some(
    (h) => h.units > 0 && h.source !== 'Fixed'
  );
  return (
    s.balance.length === 0 &&
    s.transactions.length === 0 &&
    !s.khumsTaxConfig &&
    !hasInvestedLiveHolding &&
    s.holdings.length <= 9
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [state, setState] = useState<FinanceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [fromDate, setFromDate] = useState(firstDayOfMonthIso());
  const [toDate, setToDate] = useState(todayIso());

  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [refreshingIndicators, setRefreshingIndicators] = useState(false);
  const [priceStatusText, setPriceStatusText] = useState('');
  const [priceFailedDetails, setPriceFailedDetails] = useState<
    Array<{ symbol: string; reason: string }>
  >([]);
  const [preAuthLanguage, setPreAuthLanguage] = useState<AppLanguage>(() => readStoredLanguage());
  const [statementModalOpen, setStatementModalOpen] = useState(false);
  const [reopenOnboarding, setReopenOnboarding] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [lockedFeature, setLockedFeature] = useState<LockedFeatureKey | undefined>(undefined);
  const [billingConfig, setBillingConfig] = useState<BillingConfigResponse | null>(null);
  const [qrBlobUrl, setQrBlobUrl] = useState<string | null>(null);
  const [billingNotice, setBillingNotice] = useState('');
  const [inactivityWarningSeconds, setInactivityWarningSeconds] = useState<number | null>(null);
  const [autoLogoutNotice, setAutoLogoutNotice] = useState('');

  const didAutoRefresh = useRef(false);
  const lastActivityRef = useRef<number>(Date.now());
  const autoLogoutInFlightRef = useRef(false);
  const qrBlobUrlRef = useRef<string | null>(null);

  const activeLanguage: AppLanguage = state?.settings.language ?? preAuthLanguage;
  const t = getTranslations(activeLanguage);

  const handleSelectPreAuthLanguage = (lang: AppLanguage) => {
    setPreAuthLanguage(lang);
    writeStoredLanguage(lang);
  };

  const replaceQrBlobUrl = useCallback((nextUrl: string | null) => {
    if (qrBlobUrlRef.current && qrBlobUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(qrBlobUrlRef.current);
    }
    qrBlobUrlRef.current = nextUrl;
    setQrBlobUrl(nextUrl);
  }, []);

  useEffect(() => {
    return () => {
      if (qrBlobUrlRef.current) {
        URL.revokeObjectURL(qrBlobUrlRef.current);
        qrBlobUrlRef.current = null;
      }
    };
  }, []);

  const resetLocalSessionUi = useCallback(() => {
    setState(null);
    setError('');
    setPriceStatusText('');
    setPriceFailedDetails([]);
    setStatementModalOpen(false);
    setReopenOnboarding(false);
    setUpgradeModalOpen(false);
    setLockedFeature(undefined);
    setBillingConfig(null);
    replaceQrBlobUrl(null);
    setBillingNotice('');
    setInactivityWarningSeconds(null);
    setActiveTab('overview');
  }, [replaceQrBlobUrl]);

  const triggerAutoLogout = useCallback(
    async (uid?: string | null) => {
      if (autoLogoutInFlightRef.current) return;
      autoLogoutInFlightRef.current = true;
      try {
        clearStoredActivity(uid);
        resetLocalSessionUi();
        setAutoLogoutNotice(getTranslations(readStoredLanguage()).autoLogoutMsg);
        await signOut(auth);
      } finally {
        autoLogoutInFlightRef.current = false;
      }
    },
    [resetLocalSessionUi]
  );

  const recordUserActivity = useCallback((uid?: string | null) => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (uid) {
      writeStoredActivity(uid, now);
    }
    setInactivityWarningSeconds((prev) => (prev !== null ? null : prev));
  }, []);

  useEffect(() => {
    void testFirestoreConnection();

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user && !isVerifiedUser(user)) {
        const attempted = user.email || 'this account';
        await signOut(auth);
        setCurrentUser(null);
        resetLocalSessionUi();
        setAuthError(
          `Your Google account (${attempted}) does not have a verified email address.`
        );
        setAuthReady(true);
        return;
      }

      if (user) {
        const storedActivity = readStoredActivity(user.uid);
        const now = Date.now();
        if (storedActivity !== null && now - storedActivity >= INACTIVITY_TIMEOUT_MS) {
          clearStoredActivity(user.uid);
          await signOut(auth);
          setCurrentUser(null);
          resetLocalSessionUi();
          setAutoLogoutNotice('You were automatically signed out after 10 minutes of inactivity.');
          setAuthReady(true);
          return;
        }
        const activeAt = storedActivity ?? now;
        lastActivityRef.current = activeAt;
        writeStoredActivity(user.uid, activeAt);
        setAuthError('');
        setAutoLogoutNotice('');
      }

      resetLocalSessionUi();
      setCurrentUser(user);
      setAuthReady(true);
    });

    return () => unsub();
  }, [resetLocalSessionUi]);

  useEffect(() => {
    if (!authReady || !currentUser) return;
    const uid = currentUser.uid;
    let lastRecorded = lastActivityRef.current;

    const handleActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current >= INACTIVITY_TIMEOUT_MS) {
        void triggerAutoLogout(uid);
        return;
      }
      if (now - lastRecorded >= 1000) {
        lastRecorded = now;
        recordUserActivity(uid);
      } else {
        lastActivityRef.current = now;
        setInactivityWarningSeconds((prev) => (prev !== null ? null : prev));
      }
    };

    const checkInactivity = () => {
      const stored = readStoredActivity(uid);
      const effectiveLast = Math.max(lastActivityRef.current, stored ?? 0);
      const elapsed = Date.now() - effectiveLast;
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        void triggerAutoLogout(uid);
        return;
      }
      const remaining = INACTIVITY_TIMEOUT_MS - elapsed;
      if (remaining <= INACTIVITY_WARNING_MS) {
        setInactivityWarningSeconds(Math.max(1, Math.ceil(remaining / 1000)));
      } else {
        setInactivityWarningSeconds((prev) => (prev !== null ? null : prev));
      }
    };

    const activityEvents: Array<keyof WindowEventMap> = [
      'pointerdown',
      'mousedown',
      'keydown',
      'touchstart',
      'wheel',
      'input',
    ];
    for (const evt of activityEvents) {
      window.addEventListener(evt, handleActivity, { passive: true });
    }
    window.addEventListener('scroll', handleActivity, { passive: true, capture: true });
    window.addEventListener('focus', checkInactivity);
    document.addEventListener('visibilitychange', checkInactivity);

    const intervalId = window.setInterval(checkInactivity, 1000);
    checkInactivity();

    return () => {
      for (const evt of activityEvents) {
        window.removeEventListener(evt, handleActivity);
      }
      window.removeEventListener('scroll', handleActivity, { capture: true });
      window.removeEventListener('focus', checkInactivity);
      document.removeEventListener('visibilitychange', checkInactivity);
      window.clearInterval(intervalId);
    };
  }, [authReady, currentUser, recordUserActivity, triggerAutoLogout]);

  const requestJson = useCallback(
    async <T,>(url: string, options?: RequestInit): Promise<T> => {
      const user = auth.currentUser;
      if (!user || !isVerifiedUser(user)) {
        throw new Error('Authentication required');
      }

      const performFetch = async (forceRefresh: boolean) => {
        const token = await user.getIdToken(forceRefresh);
        return fetch(url, {
          ...options,
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(options?.headers || {}),
          },
        });
      };

      let res = await performFetch(false);
      if (res.status === 401) {
        res = await performFetch(true);
      }

      const rawText = await res.text();
      let data: (T & { error?: string }) | null = null;
      if (rawText) {
        try {
          data = JSON.parse(rawText) as T & { error?: string };
        } catch {
          data = null;
        }
      }

      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      if (!data) {
        throw new Error('Server returned an empty or invalid response.');
      }
      return data;
    },
    []
  );

  const applyAndSyncState = useCallback((next: FinanceState) => {
    setState(next);
    const user = auth.currentUser;
    if (user && isVerifiedUser(user)) {
      void syncStateToFirestore(user, next).catch((err) => {
        console.error('Firestore backup sync failed:', err);
      });
    }
  }, []);

  const handleRefreshPrices = useCallback(async () => {
    setRefreshingPrices(true);
    setPriceStatusText('Fetching live DSE & UTT AMIS prices...');
    setPriceFailedDetails([]);
    try {
      const result = await requestJson<RefreshPricesResponse>('/api/prices/refresh', {
        method: 'POST',
      });
      applyAndSyncState(result.state);
      setPriceStatusText(result.message);
      setPriceFailedDetails(result.failed || []);
    } catch (e) {
      setPriceStatusText(`Error updating prices: ${(e as Error).message}`);
    } finally {
      setRefreshingPrices(false);
    }
  }, [requestJson, applyAndSyncState]);

  const handleRefreshIndicators = useCallback(async () => {
    setRefreshingIndicators(true);
    try {
      const result = await requestJson<{ state: FinanceState; message: string }>(
        '/api/indicators/refresh',
        { method: 'POST' }
      );
      applyAndSyncState(result.state);
      setPriceStatusText(result.message);
    } catch (e) {
      setPriceStatusText(`Error updating indicators: ${(e as Error).message}`);
    } finally {
      setRefreshingIndicators(false);
    }
  }, [requestJson, applyAndSyncState]);

  const fetchProtectedQrBlobUrl = useCallback(async (stamp: string): Promise<string | null> => {
    const user = auth.currentUser;
    if (!user || !isVerifiedUser(user)) return null;
    const performFetch = async (forceRefresh: boolean) => {
      const token = await user.getIdToken(forceRefresh);
      return fetch(`/api/billing/qr-image?v=${encodeURIComponent(stamp || '1')}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
    };
    let res = await performFetch(false);
    if (res.status === 401) {
      res = await performFetch(true);
    }
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }, []);

  const refreshBillingConfigAndQr = useCallback(async () => {
    try {
      const cfg = await requestJson<BillingConfigResponse>('/api/billing/config');
      setBillingConfig(cfg);
      if (cfg.hasQrCode) {
        const nextUrl = await fetchProtectedQrBlobUrl(cfg.qrUpdatedAt || String(Date.now()));
        replaceQrBlobUrl(nextUrl);
      } else {
        replaceQrBlobUrl(null);
      }
    } catch {
      // Non-fatal fallback
    }
  }, [requestJson, fetchProtectedQrBlobUrl, replaceQrBlobUrl]);

  useEffect(() => {
    if (!authReady || !currentUser) return;
    let mounted = true;
    setLoading(true);
    setError('');
    didAutoRefresh.current = false;

    (async () => {
      try {
        let activeState = await requestJson<FinanceState>('/api/state');
        if (!mounted) return;

        try {
          await syncUserProfile(currentUser, 'TZS');
          if (isFreshSeededState(activeState)) {
            const cloud = await loadStateFromFirestore(currentUser);
            if (cloud.hasData && mounted) {
              activeState = await requestJson<FinanceState>('/api/state/restore', {
                method: 'POST',
                body: JSON.stringify(cloud),
              });
            }
          }
        } catch (cloudErr) {
          console.error('Firestore profile/restore sync failed:', cloudErr);
        }

        if (!mounted) return;
        const preferredLang = readStoredLanguage();
        if (!activeState.settings.onboardingCompleted && activeState.settings.language !== preferredLang) {
          try {
            activeState = await requestJson<FinanceState>('/api/settings', {
              method: 'POST',
              body: JSON.stringify({ language: preferredLang }),
            });
          } catch {
            // Keep loaded language if initial sync fails
          }
        } else if (activeState.settings.language) {
          writeStoredLanguage(activeState.settings.language);
        }

        // Load billing config & QR image
        try {
          const billingCfg = await requestJson<BillingConfigResponse>('/api/billing/config');
          if (mounted) {
            setBillingConfig(billingCfg);
            if (billingCfg.hasQrCode) {
              const url = await fetchProtectedQrBlobUrl(billingCfg.qrUpdatedAt || '1');
              if (mounted) {
                replaceQrBlobUrl(url);
              } else if (url) {
                URL.revokeObjectURL(url);
              }
            } else {
              replaceQrBlobUrl(null);
            }
          }
        } catch {
          // Non-fatal fallback
        }

        const params = new URLSearchParams(window.location.search);
        const checkoutStatus = params.get('checkout');
        const sessionId = params.get('session_id');
        if (checkoutStatus === 'success' && sessionId) {
          try {
            const confirmed = await requestJson<{ state: FinanceState }>(
              '/api/billing/confirm-stripe',
              {
                method: 'POST',
                body: JSON.stringify({ sessionId }),
              }
            );
            activeState = confirmed.state;
            if (mounted) {
              setBillingNotice(
                activeState.settings.language === 'sw'
                  ? 'Malipo ya $5 yamehakikiwa — FinanceDesk Pro imefunguliwa!'
                  : 'Payment of $5 confirmed — FinanceDesk Pro is now unlocked!'
              );
            }
          } catch (checkoutErr) {
            if (mounted) {
              setBillingNotice((checkoutErr as Error).message);
            }
          } finally {
            window.history.replaceState({}, '', window.location.pathname);
          }
        } else if (checkoutStatus === 'cancelled') {
          window.history.replaceState({}, '', window.location.pathname);
        }

        if (!mounted) return;
        applyAndSyncState(activeState);
        setLoading(false);

        if (activeState.settings.autoRefreshOnOpen && !didAutoRefresh.current) {
          didAutoRefresh.current = true;
          void handleRefreshPrices();
          void handleRefreshIndicators();
        }
      } catch (e) {
        if (!mounted) return;
        setError((e as Error).message);
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [
    authReady,
    currentUser,
    requestJson,
    applyAndSyncState,
    handleRefreshPrices,
    handleRefreshIndicators,
    fetchProtectedQrBlobUrl,
    replaceQrBlobUrl,
  ]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError('');
    setAutoLogoutNotice('');
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (!isVerifiedUser(cred.user)) {
        const attempted = cred.user.email || 'this account';
        await signOut(auth);
        setAuthError(
          `Your Google account (${attempted}) does not have a verified email address.`
        );
      } else {
        const now = Date.now();
        lastActivityRef.current = now;
        writeStoredActivity(cred.user.uid, now);
      }
    } catch (e) {
      const msg = (e as Error).message || 'Sign-in cancelled or failed.';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(msg);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    clearStoredActivity(currentUser?.uid);
    setAutoLogoutNotice('');
    resetLocalSessionUi();
    await signOut(auth);
  };

  const saveSettings = async (patch: {
    language?: AppLanguage;
    target?: number;
    autoRefreshOnOpen?: boolean;
    onboardingCompleted?: boolean;
    khumsEnabled?: boolean;
    monthlyFixedExpenses?: MonthlyFixedExpense[];
  }) => {
    if (patch.language) {
      setPreAuthLanguage(patch.language);
      writeStoredLanguage(patch.language);
    }
    const next = await requestJson<FinanceState>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    applyAndSyncState(next);
  };

  const openUpgradeModal = useCallback(
    (feature?: LockedFeatureKey) => {
      setLockedFeature(feature);
      setUpgradeModalOpen(true);
      void refreshBillingConfigAndQr();
    },
    [refreshBillingConfigAndQr]
  );

  const createProCheckout = async () => {
    const res = await requestJson<{
      mode: 'stripe' | 'sandbox' | 'already_pro';
      checkoutUrl?: string;
      sessionId?: string;
      state?: FinanceState;
    }>('/api/billing/create-checkout', {
      method: 'POST',
    });
    if (res.mode === 'already_pro' && res.state) {
      applyAndSyncState(res.state);
    }
    return res;
  };

  const submitPaymentClaim = async (payload: { username: string; note: string }) => {
    const res = await requestJson<{ state: FinanceState }>('/api/billing/submit-claim', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    applyAndSyncState(res.state);
  };

  const fetchAdminOverview = useCallback(async () => {
    return requestJson<{
      users: AdminUserRecord[];
      config: {
        hasQrCode: boolean;
        qrUpdatedAt: string;
        paymentInstructions: string;
        whatsappNumber: string;
      };
    }>('/api/admin/overview');
  }, [requestJson]);

  const uploadAdminQrImage = useCallback(
    async (file: File) => {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowed.includes(file.type)) {
        throw new Error('Only PNG, JPG, or WEBP QR code images are supported.');
      }
      if (file.size > 2 * 1024 * 1024) {
        throw new Error('QR code image must be 2 MB or smaller.');
      }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read QR code image.'));
        reader.readAsDataURL(file);
      });
      await requestJson<{ ok: boolean }>('/api/admin/qr', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          dataBase64,
        }),
      });
      await refreshBillingConfigAndQr();
    },
    [requestJson, refreshBillingConfigAndQr]
  );

  const deleteAdminQrImage = useCallback(async () => {
    await requestJson<{ ok: boolean }>('/api/admin/qr', {
      method: 'DELETE',
    });
    await refreshBillingConfigAndQr();
  }, [requestJson, refreshBillingConfigAndQr]);

  const saveAdminBillingConfig = useCallback(
    async (payload: { whatsappNumber: string; paymentInstructions: string }) => {
      await requestJson<{ ok: boolean }>('/api/admin/billing-config', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await refreshBillingConfigAndQr();
    },
    [requestJson, refreshBillingConfigAndQr]
  );

  const setAdminUserPlan = useCallback(
    async (payload: { email: string; plan: PlanTier; paymentRef?: string; note?: string }) => {
      const res = await requestJson<{ ok: boolean; users: AdminUserRecord[] }>(
        '/api/admin/users/plan',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      if (
        currentUser?.email &&
        payload.email.trim().toLowerCase() === currentUser.email.trim().toLowerCase()
      ) {
        const refreshed = await requestJson<FinanceState>('/api/state');
        applyAndSyncState(refreshed);
      }
      return res.users;
    },
    [requestJson, currentUser?.email, applyAndSyncState]
  );

  const authorizeReport = useCallback(async (): Promise<boolean> => {
    try {
      await requestJson<{ ok: boolean }>('/api/reports/authorize', { method: 'POST' });
      return true;
    } catch {
      openUpgradeModal('reports');
      return false;
    }
  }, [requestJson, openUpgradeModal]);

  const handleCompleteOnboarding = async (payload: {
    language: AppLanguage;
    target: number;
    khumsEnabled: boolean;
    monthlyFixedExpenses: MonthlyFixedExpense[];
    logToLedgerNow: boolean;
    openCheckoutAfterSave?: boolean;
  }) => {
    setPreAuthLanguage(payload.language);
    writeStoredLanguage(payload.language);

    let next = await requestJson<FinanceState>('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        language: payload.language,
        target: payload.target,
        khumsEnabled: payload.khumsEnabled,
        monthlyFixedExpenses: payload.monthlyFixedExpenses,
        onboardingCompleted: true,
      }),
    });

    if (payload.logToLedgerNow) {
      const filled = payload.monthlyFixedExpenses.filter(
        (item) => item.description.trim().length > 0 && item.amount > 0
      );
      if (filled.length > 0) {
        const today = todayIso();
        next = await requestJson<FinanceState>('/api/transactions/batch', {
          method: 'POST',
          body: JSON.stringify({
            items: filled.map((item) => ({
              date: today,
              activity: 'operating' as TransactionActivity,
              category: item.category || 'Other',
              description: item.description.trim(),
              amount: -Math.abs(item.amount),
            })),
          }),
        });
      }
    }

    applyAndSyncState(next);
    setReopenOnboarding(false);
    if (payload.openCheckoutAfterSave && next.settings.plan !== 'pro') {
      openUpgradeModal('signup');
    }
  };

  const handleSkipOnboarding = async () => {
    if (state && !state.settings.onboardingCompleted) {
      await saveSettings({ onboardingCompleted: true });
    }
    setReopenOnboarding(false);
  };

  const saveKhumsTaxConfig = async (config: KhumsTaxConfig) => {
    const next = await requestJson<FinanceState>('/api/calculators/khums-tax', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    applyAndSyncState(next);
  };

  const saveBalance = async (
    payload: {
      date: string;
      section: BalanceSection;
      type: BalanceType;
      name: string;
      amount: number;
    },
    id?: number
  ) => {
    const next = await requestJson<FinanceState>(
      id ? `/api/balance/${id}` : '/api/balance',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );
    applyAndSyncState(next);
  };

  const deleteBalance = async (id: number) => {
    const next = await requestJson<FinanceState>(`/api/balance/${id}`, {
      method: 'DELETE',
    });
    applyAndSyncState(next);
  };

  const uploadReceipt = useCallback(async (file: File) => {
    const user = auth.currentUser;
    if (!user || !isVerifiedUser(user)) {
      throw new Error('Authentication required');
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      throw new Error('Only JPG, PNG, WEBP, or PDF receipts are supported.');
    }
    if (file.size > 4 * 1024 * 1024) {
      throw new Error('Receipt file must be 4 MB or smaller.');
    }

    const dataBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read receipt file.'));
      reader.readAsDataURL(file);
    });

    return requestJson<{ receiptId: string; receiptName: string; receiptMime: string }>(
      '/api/receipts',
      {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          dataBase64,
        }),
      }
    );
  }, [requestJson]);

  const fetchReceiptBlobUrl = useCallback(async (receiptId: string): Promise<string> => {
    const user = auth.currentUser;
    if (!user || !isVerifiedUser(user)) {
      throw new Error('Authentication required');
    }
    const performFetch = async (forceRefresh: boolean) => {
      const token = await user.getIdToken(forceRefresh);
      return fetch(`/api/receipts/${encodeURIComponent(receiptId)}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
    };
    let res = await performFetch(false);
    if (res.status === 401) {
      res = await performFetch(true);
    }
    if (!res.ok) {
      throw new Error('Receipt file is not available on this server.');
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }, []);

  const saveTransaction = async (
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
  ) => {
    const next = await requestJson<FinanceState>(
      id ? `/api/transactions/${id}` : '/api/transactions',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );
    applyAndSyncState(next);
  };

  const deleteTransaction = async (id: number) => {
    const next = await requestJson<FinanceState>(`/api/transactions/${id}`, {
      method: 'DELETE',
    });
    applyAndSyncState(next);
  };

  const transferBetweenBanks = async (payload: {
    fromBank: string;
    toBank: string;
    amount: number;
    date: string;
  }) => {
    const next = await requestJson<FinanceState>('/api/balance/transfer', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    applyAndSyncState(next);
  };

  const addTransactionsBatch = async (
    items: Array<{
      date: string;
      activity: TransactionActivity;
      category: string;
      description: string;
      amount: number;
    }>
  ) => {
    const next = await requestJson<FinanceState>('/api/transactions/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    applyAndSyncState(next);
  };

  const parseBankStatement = async (payload: {
    filename: string;
    mimeType: string;
    dataBase64?: string;
    textContent?: string;
    bankNameHint?: string;
  }): Promise<ParsedStatementResult> => {
    return requestJson<ParsedStatementResult>('/api/bank-statement/parse', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  };

  const importBankStatement = async (payload: {
    items: ParsedStatementItem[];
    closingBalanceUpdate?: { bankName: string; amount: number; date: string } | null;
  }) => {
    const res = await requestJson<{
      imported: { transactions: number; balance: number; holdings: number };
      state: FinanceState;
    }>('/api/bank-statement/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    applyAndSyncState(res.state);
    return { imported: res.imported };
  };

  const lookupHoldingQuote = useCallback(
    async (payload: {
      symbol: string;
      source: PriceSource;
      url: string;
      selector: string;
      regex: string;
    }) => {
      return requestJson<{
        priceTzs: number;
        resolvedSymbol: string;
        nativePrice: number;
        nativeCurrency: string;
        fxRate: number;
        sourceLabel: string;
      }>('/api/holdings/quote', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    [requestJson]
  );

  const saveHolding = async (
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
  ) => {
    const next = await requestJson<FinanceState>(
      id ? `/api/holdings/${id}` : '/api/holdings',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );
    applyAndSyncState(next);
  };

  const deleteHolding = async (id: number) => {
    const next = await requestJson<FinanceState>(`/api/holdings/${id}`, {
      method: 'DELETE',
    });
    applyAndSyncState(next);
  };

  const restoreStarter = async () => {
    const next = await requestJson<FinanceState>('/api/holdings/starter', {
      method: 'POST',
    });
    applyAndSyncState(next);
  };

  const saveIndicator = async (
    payload: { name: string; url: string; selector: string; regex: string },
    id?: number
  ) => {
    const next = await requestJson<FinanceState>(
      id ? `/api/indicators/${id}` : '/api/indicators',
      {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      }
    );
    applyAndSyncState(next);
  };

  const deleteIndicator = async (id: number) => {
    const next = await requestJson<FinanceState>(`/api/indicators/${id}`, {
      method: 'DELETE',
    });
    applyAndSyncState(next);
  };

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B0B0B] px-4 text-sm text-[#8A8A8A]">
        {t.verifyingSession}
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0B0B0B] px-4 py-8 text-[#F2F2F2] sm:px-6">
        <div className="w-full max-w-md rounded-xl border border-[#242424] bg-[#121212] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-[#C1121F]" />
              <span className="text-sm font-bold tracking-[0.18em] text-[#C1121F]">
                FINANCEDESK
              </span>
            </div>

            <div
              role="group"
              aria-label="Language"
              className="inline-flex items-center rounded-md border border-[#2C2C2C] bg-[#0B0B0B] p-0.5"
            >
              {(['en', 'sw'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => handleSelectPreAuthLanguage(lang)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold uppercase transition-colors ${
                    preAuthLanguage === lang
                      ? 'bg-[#C1121F] text-white'
                      : 'text-[#9A9A9A] hover:text-white'
                  }`}
                >
                  {lang === 'en' ? 'English' : 'Kiswahili'}
                </button>
              ))}
            </div>
          </div>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-white">
            {t.signInTitle}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#9A9A9A]">{t.signInSubtitle}</p>

          {autoLogoutNotice && (
            <div
              role="status"
              className="mt-4 flex items-start gap-2 rounded-md border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-200"
            >
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>{autoLogoutNotice}</span>
            </div>
          )}

          {authError && (
            <div
              role="alert"
              className="mt-4 rounded-md border border-red-900/60 bg-[#1F0B0D] px-4 py-3 text-xs text-red-300"
            >
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={signingIn}
            className="mt-6 flex min-h-[48px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[#C1121F] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#D91A28] disabled:opacity-50"
          >
            {signingIn ? t.signingIn : t.signInGoogle}
          </button>
        </div>
      </div>
    );
  }

  const showOnboarding = Boolean(state && (!state.settings.onboardingCompleted || reopenOnboarding));
  const khumsEnabled = state?.settings.khumsEnabled !== false;
  const isPro = state?.settings.plan === 'pro';
  const isAdmin = Boolean(state?.settings.isAdmin);
  const navTabs: Array<{
    key: TabKey;
    label: string;
    mobileLabel: string;
    icon: typeof LayoutDashboard;
  }> = [
    { key: 'overview', label: t.navOverview, mobileLabel: t.mobileOverview, icon: LayoutDashboard },
    {
      key: 'working-capital',
      label: t.navWorkingCapital,
      mobileLabel: t.mobileCashFlow,
      icon: Wallet,
    },
    { key: 'long-term', label: t.navLongTerm, mobileLabel: t.mobileLongTerm, icon: Landmark },
    {
      key: 'investments',
      label: t.navInvestments,
      mobileLabel: t.mobilePortfolio,
      icon: TrendingUp,
    },
    {
      key: 'khums-tax',
      label: khumsEnabled ? t.navKhumsTax : t.navTaxOnly,
      mobileLabel: khumsEnabled ? t.mobileKhums : t.mobileTaxes,
      icon: Calculator,
    },
    ...(isAdmin
      ? [{ key: 'admin' as const, label: t.navAdmin, mobileLabel: t.mobileAdmin, icon: ShieldCheck }]
      : []),
  ];
  const currentTab: TabKey = activeTab === 'admin' && !isAdmin ? 'overview' : activeTab;

  return (
    <div className="min-h-screen bg-[#0B0B0B] text-[#F2F2F2]">
      {/* 3-Zone Top Bar Contract (Desktop inline nav; Mobile compact actions) */}
      <header className="border-b border-[#222222] bg-[#0B0B0B]">
        <div className="mx-auto flex max-w-[1380px] items-center justify-between gap-2 px-4 py-3 sm:gap-6 sm:px-6 sm:py-3.5">
          {/* Zone 1: Single-element brand wordmark */}
          <span className="shrink-0 whitespace-nowrap text-sm font-bold tracking-[0.16em] text-[#C1121F] sm:text-base sm:tracking-[0.18em]">
            FINANCEDESK
          </span>

          {/* Zone 2: Concise single-line tab links (hidden on mobile; bottom bar takes over) */}
          {showOnboarding ? (
            <span className="hidden whitespace-nowrap text-xs font-medium text-[#9A9A9A] sm:inline-block">
              {t.workspaceSetup}
            </span>
          ) : (
            <nav
              aria-label="Primary sections"
              className="hidden items-center gap-5 overflow-x-auto md:flex lg:gap-6"
            >
              {navTabs.map((tab) => {
                const isActive = currentTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`shrink-0 whitespace-nowrap border-b-2 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#C1121F] ${
                      isActive
                        ? 'border-[#C1121F] text-white'
                        : 'border-transparent text-[#8A8A8A] hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          )}

          {/* Zone 3: Active account + Pro upgrade + Refresh + Sign out */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            {currentUser.email && (
              <span
                title={`Signed in as ${currentUser.email}`}
                className="hidden max-w-[160px] truncate text-xs text-[#9A9A9A] xl:inline-block"
              >
                {currentUser.email}
              </span>
            )}
            {state && !isPro && (
              <button
                type="button"
                onClick={() => openUpgradeModal()}
                className="inline-flex min-h-[38px] shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-[#C1121F] bg-[#19090B] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#C1121F] sm:min-h-0 sm:px-3"
              >
                <Crown className="h-3.5 w-3.5 text-[#C1121F]" />
                <span className="hidden sm:inline">{t.upgradeCta}</span>
                <span className="sm:hidden">$5 Pro</span>
              </button>
            )}
            {state && isPro && (
              <span className="hidden items-center gap-1 rounded border border-emerald-800/70 bg-emerald-950/35 px-2 py-1 text-[11px] font-semibold tracking-wider text-emerald-300 sm:inline-flex">
                <Crown className="h-3 w-3" />
                {t.proBadge}
              </span>
            )}
            {!showOnboarding && (
              <button
                type="button"
                onClick={() => void handleRefreshPrices()}
                disabled={refreshingPrices}
                className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-[#C1121F] px-2.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0 sm:gap-2 sm:px-3.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingPrices ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">
                  {refreshingPrices ? t.updating : t.refreshPrices}
                </span>
                <span className="sm:hidden">{refreshingPrices ? '...' : t.refreshShort}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              title={`Signed in as ${currentUser.email} — Click to switch or sign out`}
              aria-label="Sign out"
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-[#2C2C2C] px-2.5 py-2 text-xs font-medium text-[#CCCCCC] transition-colors hover:border-[#C1121F] hover:text-white sm:min-h-0 sm:px-3"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.signOut}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1380px] px-4 py-4 pb-24 sm:px-6 sm:py-6 md:pb-8">
        {billingNotice && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-800/70 bg-emerald-950/35 px-4 py-3 text-xs text-emerald-200"
          >
            <span>{billingNotice}</span>
            <button
              type="button"
              onClick={() => setBillingNotice('')}
              className="shrink-0 font-semibold text-emerald-300 hover:text-white"
            >
              OK
            </button>
          </div>
        )}

        {inactivityWarningSeconds !== null && (
          <div
            role="alert"
            className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-700/70 bg-amber-950/35 px-4 py-3 text-xs text-amber-100 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2.5 sm:items-center">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400 sm:mt-0" />
              <span>
                {t.inactivityWarningPrefix}{' '}
                <strong className="font-mono-nums text-white">{inactivityWarningSeconds}s</strong>{' '}
                {t.inactivityWarningSuffix}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <button
                type="button"
                onClick={() => recordUserActivity(currentUser.uid)}
                className="min-h-[36px] rounded-md bg-[#C1121F] px-3 py-1.5 font-semibold text-white transition-colors hover:bg-[#D91A28]"
              >
                {t.staySignedIn}
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="min-h-[36px] rounded-md border border-amber-700/60 bg-[#0B0B0B] px-3 py-1.5 font-medium text-amber-100 hover:border-amber-500"
              >
                {t.signOutNow}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-6" aria-busy="true" aria-label="Loading FinanceDesk">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-lg border border-[#242424] bg-[#121212]"
                />
              ))}
            </div>
            <div className="h-72 animate-pulse rounded-lg border border-[#242424] bg-[#121212]" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-900/60 bg-[#1A0D0E] p-6 text-sm text-red-300">
            Failed to load FinanceDesk data: {error}
          </div>
        ) : state && showOnboarding ? (
          <OnboardingSetup
            userEmail={currentUser.email || ''}
            state={state}
            language={activeLanguage}
            onLanguageChange={(lang) => saveSettings({ language: lang })}
            onCompleteOnboarding={handleCompleteOnboarding}
            onSkipOnboarding={handleSkipOnboarding}
            onOpenUpgrade={() => openUpgradeModal('signup')}
          />
        ) : state ? (
          <>
            {currentTab === 'overview' && (
              <OverviewTab
                state={state}
                language={activeLanguage}
                fromDate={fromDate}
                toDate={toDate}
                onFromDateChange={setFromDate}
                onToDateChange={setToDate}
                onSaveSettings={saveSettings}
                onNavigateTab={setActiveTab}
                onOpenStatementImport={() => setStatementModalOpen(true)}
                onOpenSetup={() => setReopenOnboarding(true)}
                onRequirePro={(feature) => openUpgradeModal(feature)}
                onAuthorizeReport={authorizeReport}
              />
            )}
            {currentTab === 'working-capital' && (
              <WorkingCapitalTab
                state={state}
                language={activeLanguage}
                onSaveBalance={saveBalance}
                onDeleteBalance={deleteBalance}
                onTransferBanks={transferBetweenBanks}
                onSaveTransaction={saveTransaction}
                onAddTransactionsBatch={addTransactionsBatch}
                onDeleteTransaction={deleteTransaction}
                onUploadReceipt={uploadReceipt}
                onFetchReceiptUrl={fetchReceiptBlobUrl}
                onOpenStatementImport={() => setStatementModalOpen(true)}
                onSaveMonthlyDefaults={(items) => saveSettings({ monthlyFixedExpenses: items })}
                onRequirePro={(feature) => openUpgradeModal(feature)}
              />
            )}
            {currentTab === 'long-term' && (
              <LongTermTab
                state={state}
                language={activeLanguage}
                onSaveBalance={saveBalance}
                onDeleteBalance={deleteBalance}
              />
            )}
            {currentTab === 'investments' && (
              <InvestmentsTab
                state={state}
                language={activeLanguage}
                refreshingPrices={refreshingPrices}
                refreshingIndicators={refreshingIndicators}
                priceStatusText={priceStatusText}
                priceFailedDetails={priceFailedDetails}
                onRefreshPrices={handleRefreshPrices}
                onRefreshIndicators={handleRefreshIndicators}
                onRestoreStarter={restoreStarter}
                onSaveHolding={saveHolding}
                onDeleteHolding={deleteHolding}
                onLookupQuote={lookupHoldingQuote}
                onSaveIndicator={saveIndicator}
                onDeleteIndicator={deleteIndicator}
              />
            )}
            {currentTab === 'khums-tax' && (
              <KhumsTaxTab
                state={state}
                language={activeLanguage}
                onSaveConfig={saveKhumsTaxConfig}
                onToggleKhums={(enabled) => saveSettings({ khumsEnabled: enabled })}
                onRequirePro={(feature) => openUpgradeModal(feature)}
              />
            )}
            {currentTab === 'admin' && isAdmin && (
              <AdminTab
                language={activeLanguage}
                currentAdminEmail={currentUser.email || ''}
                qrBlobUrl={qrBlobUrl}
                onFetchOverview={fetchAdminOverview}
                onUploadQrImage={uploadAdminQrImage}
                onDeleteQrImage={deleteAdminQrImage}
                onSaveBillingConfig={saveAdminBillingConfig}
                onSetUserPlan={setAdminUserPlan}
              />
            )}
          </>
        ) : null}
      </main>

      {/* Mobile Bottom Thumb-Zone Navigation */}
      {!showOnboarding && (
        <nav
          aria-label="Mobile sections"
          className="pb-safe fixed right-0 bottom-0 left-0 z-40 border-t border-[#222222] bg-[#0B0B0B]/95 backdrop-blur-md md:hidden"
        >
          <div className={`grid h-16 ${navTabs.length === 6 ? 'grid-cols-6' : 'grid-cols-5'}`}>
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative flex min-h-[44px] flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors ${
                    isActive ? 'text-white' : 'text-[#8A8A8A] hover:text-[#D4D4D4]'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-0 right-3 left-3 h-0.5 rounded-full bg-[#C1121F]" />
                  )}
                  <Icon className={`h-4 w-4 ${isActive ? 'text-[#C1121F]' : ''}`} />
                  <span className="max-w-full truncate">{tab.mobileLabel}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <BankStatementImportModal
        open={statementModalOpen}
        onClose={() => setStatementModalOpen(false)}
        onParseStatement={parseBankStatement}
        onImportStatement={importBankStatement}
      />

      <UpgradeModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        language={activeLanguage}
        billingConfig={billingConfig}
        qrBlobUrl={qrBlobUrl}
        defaultUsername={currentUser.displayName || currentUser.email || ''}
        userEmail={currentUser.email || ''}
        subscription={state?.settings.subscription}
        lockedFeature={lockedFeature}
        onCreateCheckout={createProCheckout}
        onSubmitClaim={submitPaymentClaim}
      />
    </div>
  );
}
