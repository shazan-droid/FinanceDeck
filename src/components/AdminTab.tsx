import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Clock,
  Crown,
  QrCode,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserMinus,
} from 'lucide-react';
import type { AdminUserRecord, AppLanguage, PlanTier } from '../types';
import { getTranslations } from '../utils/i18n';

interface AdminOverviewData {
  users: AdminUserRecord[];
  config: {
    hasQrCode: boolean;
    qrUpdatedAt: string;
    paymentInstructions: string;
    whatsappNumber: string;
  };
}

interface AdminTabProps {
  language: AppLanguage;
  currentAdminEmail: string;
  qrBlobUrl: string | null;
  onFetchOverview: () => Promise<AdminOverviewData>;
  onUploadQrImage: (file: File) => Promise<void>;
  onDeleteQrImage: () => Promise<void>;
  onSaveBillingConfig: (payload: {
    whatsappNumber: string;
    paymentInstructions: string;
  }) => Promise<void>;
  onSetUserPlan: (payload: {
    email: string;
    plan: PlanTier;
    paymentRef?: string;
    note?: string;
  }) => Promise<AdminUserRecord[]>;
}

export function AdminTab({
  language,
  currentAdminEmail,
  qrBlobUrl,
  onFetchOverview,
  onUploadQrImage,
  onDeleteQrImage,
  onSaveBillingConfig,
  onSetUserPlan,
}: AdminTabProps) {
  const t = getTranslations(language);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [hasQrCode, setHasQrCode] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState('255676252116');
  const [paymentInstructions, setPaymentInstructions] = useState('');

  const [manualEmail, setManualEmail] = useState('');
  const [manualRef, setManualRef] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid' | 'free'>('all');

  const [busyAction, setBusyAction] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await onFetchOverview();
      setUsers(data.users);
      setHasQrCode(data.config.hasQrCode);
      setWhatsappNumber(data.config.whatsappNumber || '255676252116');
      setPaymentInstructions(data.config.paymentInstructions || '');
    } catch (e) {
      setError((e as Error).message || 'Failed to load admin overview.');
    } finally {
      setLoading(false);
    }
  }, [onFetchOverview]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const counts = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let free = 0;
    for (const u of users) {
      if (u.plan === 'pro') paid += 1;
      else if (u.paymentStatus === 'pending_verification') pending += 1;
      else free += 1;
    }
    return { total: users.length, paid, pending, free };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === 'paid' && u.plan !== 'pro') return false;
      if (
        statusFilter === 'pending' &&
        !(u.plan !== 'pro' && u.paymentStatus === 'pending_verification')
      ) {
        return false;
      }
      if (
        statusFilter === 'free' &&
        !(u.plan !== 'pro' && u.paymentStatus !== 'pending_verification')
      ) {
        return false;
      }
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.claimUsername.toLowerCase().includes(q) ||
        u.claimNote.toLowerCase().includes(q) ||
        u.paymentRef.toLowerCase().includes(q)
      );
    });
  }, [users, searchTerm, statusFilter]);

  const handleQrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    setBusyAction(true);
    try {
      await onUploadQrImage(file);
      setHasQrCode(true);
      setNotice(
        language === 'sw'
          ? 'Picha ya QR code imepakiwa na kuhifadhiwa.'
          : 'Payment QR code image uploaded successfully.'
      );
    } catch (err) {
      setError((err as Error).message || 'QR code upload failed.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteQr = async () => {
    setError('');
    setNotice('');
    setBusyAction(true);
    try {
      await onDeleteQrImage();
      setHasQrCode(false);
      setNotice(language === 'sw' ? 'Picha ya QR code imeondolewa.' : 'Payment QR code removed.');
    } catch (err) {
      setError((err as Error).message || 'Could not remove QR code.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusyAction(true);
    try {
      await onSaveBillingConfig({ whatsappNumber, paymentInstructions });
      setNotice(
        language === 'sw'
          ? 'Mipangilio ya QR & WhatsApp imehifadhiwa.'
          : 'WhatsApp & payment instructions saved.'
      );
    } catch (err) {
      setError((err as Error).message || 'Failed to save payment settings.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleManualAddPaid = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!manualEmail.trim()) return;
    setBusyAction(true);
    try {
      const updated = await onSetUserPlan({
        email: manualEmail.trim(),
        plan: 'pro',
        paymentRef: manualRef.trim() || undefined,
      });
      setUsers(updated);
      setManualEmail('');
      setManualRef('');
      setNotice(
        language === 'sw'
          ? 'Akaunti imewekwa kuwa Mteja Aliyelipa ($5 Pro).'
          : 'Customer manually activated as Paid ($5 Pro).'
      );
    } catch (err) {
      setError((err as Error).message || 'Could not activate customer.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleToggleUserPlan = async (user: AdminUserRecord, targetPlan: PlanTier) => {
    setError('');
    setNotice('');
    setBusyEmail(user.email);
    try {
      const updated = await onSetUserPlan({
        email: user.email,
        plan: targetPlan,
      });
      setUsers(updated);
      setNotice(
        targetPlan === 'pro'
          ? language === 'sw'
            ? `${user.email} amewashwa kuwa Pro.`
            : `${user.email} is now marked as a Paid Customer (Pro).`
          : language === 'sw'
            ? `${user.email} amerudishwa kwenye Mpango wa Bure.`
            : `${user.email} was moved back to the Free plan.`
      );
    } catch (err) {
      setError((err as Error).message || 'Could not update user plan.');
    } finally {
      setBusyEmail(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#C1121F]" />
            <h1 className="text-xl font-semibold tracking-tight text-white">{t.adminTitle}</h1>
          </div>
          <p className="mt-1 text-xs text-[#9A9A9A]">{t.adminSubtitle}</p>
        </div>

        <button
          type="button"
          onClick={() => void loadOverview()}
          disabled={loading}
          className="inline-flex min-h-[38px] items-center justify-center gap-2 self-start rounded-md border border-[#2C2C2C] bg-[#121212] px-3.5 py-2 text-xs font-medium text-[#E0E0E0] hover:border-[#C1121F] hover:text-white disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{t.refreshShort}</span>
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-lg border border-emerald-800/70 bg-emerald-950/35 px-4 py-3 text-xs text-emerald-200"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            className="font-semibold text-emerald-300 hover:text-white"
          >
            OK
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/60 bg-[#1F0B0D] px-4 py-3 text-xs text-red-300"
        >
          {error}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-[#242424] bg-[#121212] p-4">
          <p className="text-xs text-[#9A9A9A]">{t.adminTotalUsers}</p>
          <p className="font-mono-nums mt-2 text-2xl font-bold text-white">{counts.total}</p>
        </div>
        <div className="rounded-lg border border-emerald-900/40 bg-[#121212] p-4">
          <p className="text-xs text-emerald-300/90">{t.adminPaidUsers}</p>
          <p className="font-mono-nums mt-2 text-2xl font-bold text-emerald-400">{counts.paid}</p>
        </div>
        <div className="rounded-lg border border-amber-800/40 bg-[#121212] p-4">
          <p className="text-xs text-amber-300/90">{t.adminPendingUsers}</p>
          <p className="font-mono-nums mt-2 text-2xl font-bold text-amber-400">{counts.pending}</p>
        </div>
        <div className="rounded-lg border border-[#242424] bg-[#121212] p-4">
          <p className="text-xs text-[#9A9A9A]">{t.adminFreeUsers}</p>
          <p className="font-mono-nums mt-2 text-2xl font-bold text-[#CCCCCC]">{counts.free}</p>
        </div>
      </div>

      {/* QR Code & Manual Customer Activation Controls */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* QR Code Upload & WhatsApp Config */}
        <section className="rounded-lg border border-[#242424] bg-[#121212] p-5">
          <h2 className="text-sm font-semibold text-white">{t.adminQrCardTitle}</h2>
          <p className="mt-1 text-xs text-[#8E8E8E]">{t.adminQrCardSubtitle}</p>

          <div className="mt-4 flex flex-col items-center gap-4 rounded-lg border border-[#262626] bg-[#0B0B0B] p-4 sm:flex-row sm:items-start">
            {hasQrCode && qrBlobUrl ? (
              <div className="shrink-0 rounded-xl border border-[#333333] bg-white p-2.5">
                <img
                  src={qrBlobUrl}
                  alt="Uploaded Payment QR Code"
                  className="h-32 w-32 object-contain"
                />
              </div>
            ) : (
              <div className="flex h-36 w-36 shrink-0 flex-col items-center justify-center rounded-xl border border-dashed border-[#383838] bg-[#121212] p-3 text-center">
                <QrCode className="h-8 w-8 text-[#C1121F]" />
                <span className="mt-2 text-[11px] text-[#888888]">{t.adminQrEmptyLabel}</span>
              </div>
            )}

            <div className="flex w-full flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void handleQrFileChange(e)}
                className="hidden"
              />
              <button
                type="button"
                disabled={busyAction}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-md bg-[#C1121F] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{hasQrCode ? t.adminQrReplaceBtn : t.adminQrUploadBtn}</span>
              </button>

              {hasQrCode && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => void handleDeleteQr()}
                  className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-md border border-[#323232] bg-[#121212] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:border-red-500 hover:text-red-300 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t.adminQrRemoveBtn}</span>
                </button>
              )}
            </div>
          </div>

          <form onSubmit={(e) => void handleSaveConfig(e)} className="mt-4 space-y-3">
            <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
              <span>{t.adminWhatsappLabel}</span>
              <input
                type="tel"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="255676252116"
                className="font-mono-nums h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none sm:text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
              <span>{t.adminInstructionsLabel}</span>
              <textarea
                rows={3}
                value={paymentInstructions}
                onChange={(e) => setPaymentInstructions(e.target.value)}
                placeholder={t.adminInstructionsPlaceholder}
                className="rounded-md border border-[#2A2A2A] bg-[#0B0B0B] p-3 text-sm text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none"
              />
            </label>

            <button
              type="submit"
              disabled={busyAction}
              className="inline-flex min-h-[40px] items-center justify-center rounded-md border border-[#C1121F] bg-[#19090B] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#C1121F] disabled:opacity-50"
            >
              {t.adminSaveBillingConfig}
            </button>
          </form>
        </section>

        {/* Quick Manual Upgrade by Email */}
        <section className="flex flex-col justify-between rounded-lg border border-[#242424] bg-[#121212] p-5">
          <div>
            <h2 className="text-sm font-semibold text-white">{t.adminAddPaidTitle}</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#8E8E8E]">
              {language === 'sw'
                ? 'Unaweza kuweka barua pepe yoyote ya Google kuwa Mteja Aliyelipa kabla au baada ya kujisajili.'
                : 'Grant $5 Pro access to any customer Google email immediately — even before their first login or right after confirming their WhatsApp message.'}
            </p>

            <form onSubmit={(e) => void handleManualAddPaid(e)} className="mt-4 space-y-3">
              <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
                <span>{t.adminAddPaidEmailLabel}</span>
                <input
                  type="email"
                  required
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="customer@gmail.com"
                  className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none sm:text-sm"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
                <span>{t.adminAddPaidRefLabel}</span>
                <input
                  type="text"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value)}
                  placeholder="WhatsApp / M-Pesa ref (optional)"
                  className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none sm:text-sm"
                />
              </label>

              <button
                type="submit"
                disabled={busyAction || !manualEmail.trim()}
                className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                <Crown className="h-3.5 w-3.5" />
                <span>{t.adminMakePaidBtn}</span>
              </button>
            </form>
          </div>

          <div className="mt-5 rounded-md border border-[#242424] bg-[#0B0B0B] px-3.5 py-2.5 text-[11px] text-[#8E8E8E]">
            <span className="font-semibold text-[#CCCCCC]">Admin:</span> {currentAdminEmail}
          </div>
        </section>
      </div>

      {/* Customer Accounts Table / Cards */}
      <section className="rounded-lg border border-[#242424] bg-[#121212] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-white">{t.adminUsersTitle}</h2>

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { key: 'all', label: `${t.adminFilterAll} (${counts.total})` },
                { key: 'pending', label: `${t.adminFilterPending} (${counts.pending})` },
                { key: 'paid', label: `${t.adminFilterPaid} (${counts.paid})` },
                { key: 'free', label: `${t.adminFilterFree} (${counts.free})` },
              ] as const
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === f.key
                    ? 'border-[#C1121F] bg-[#1F0B0D] text-white'
                    : 'border-[#2A2A2A] bg-[#0B0B0B] text-[#9A9A9A] hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#666666]" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.adminSearchPlaceholder}
            className="h-10 w-full rounded-md border border-[#2A2A2A] bg-[#0B0B0B] pr-3 pl-9 text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none sm:text-sm"
          />
        </div>

        {loading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="h-14 animate-pulse rounded-md bg-[#0B0B0B]" />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <p className="mt-6 text-center text-xs text-[#8A8A8A]">{t.adminNoUsers}</p>
        ) : (
          <div className="mt-4 space-y-2.5">
            {filteredUsers.map((user) => {
              const isPro = user.plan === 'pro';
              const isPending = !isPro && user.paymentStatus === 'pending_verification';
              const isBusy = busyEmail === user.email;

              return (
                <div
                  key={user.email}
                  className={`flex flex-col gap-3 rounded-lg border p-3.5 sm:flex-row sm:items-center sm:justify-between ${
                    isPending
                      ? 'border-amber-700/50 bg-[#171209]'
                      : isPro
                        ? 'border-emerald-900/40 bg-[#0D1510]'
                        : 'border-[#242424] bg-[#0B0B0B]'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">
                        {user.displayName || user.claimUsername || user.email}
                      </span>
                      {isPro ? (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-700/60 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          {t.adminStatusPaid}
                        </span>
                      ) : isPending ? (
                        <span className="inline-flex items-center gap-1 rounded border border-amber-700/60 bg-amber-950/50 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          <Clock className="h-3 w-3" />
                          {t.adminStatusPending}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded border border-[#2E2E2E] bg-[#161616] px-2 py-0.5 text-[10px] font-medium text-[#9A9A9A]">
                          {t.adminStatusFree}
                        </span>
                      )}
                    </div>

                    <p className="truncate text-xs text-[#A5A5A5]">{user.email}</p>

                    {(user.claimUsername || user.claimNote || user.paymentRef) && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#8E8E8E]">
                        {user.claimUsername && (
                          <span>
                            WhatsApp Username:{' '}
                            <strong className="text-[#D4D4D4]">{user.claimUsername}</strong>
                          </span>
                        )}
                        {user.claimNote && (
                          <span>
                            Note: <strong className="text-[#D4D4D4]">{user.claimNote}</strong>
                          </span>
                        )}
                        {user.paymentRef && (
                          <span className="font-mono-nums">Ref: {user.paymentRef}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isPro ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleToggleUserPlan(user, 'free')}
                        className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md border border-[#343434] bg-[#121212] px-3 py-1.5 text-xs font-medium text-[#CCCCCC] transition-colors hover:border-red-500 hover:text-red-300 disabled:opacity-50"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                        <span>{t.adminSetFreeBtn}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleToggleUserPlan(user, 'pro')}
                        className={`inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50 ${
                          isPending
                            ? 'bg-emerald-600 hover:bg-emerald-500'
                            : 'bg-[#C1121F] hover:bg-[#D91A28]'
                        }`}
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>{isPending ? t.adminApproveBtn : t.adminMakePaidBtn}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
