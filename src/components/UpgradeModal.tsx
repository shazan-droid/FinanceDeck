import { useEffect, useState } from 'react';
import {
  Check,
  Clock,
  CreditCard,
  Lock,
  MessageCircle,
  QrCode,
  ShieldCheck,
} from 'lucide-react';
import type { AppLanguage, BillingConfigResponse, SubscriptionInfo } from '../types';
import { getTranslations } from '../utils/i18n';
import { Modal } from './Modal';

export type LockedFeatureKey = 'ai_import' | 'taxes' | 'reports' | 'signup';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  language: AppLanguage;
  billingConfig: BillingConfigResponse | null;
  qrBlobUrl: string | null;
  defaultUsername: string;
  userEmail: string;
  subscription?: SubscriptionInfo;
  lockedFeature?: LockedFeatureKey;
  onCreateCheckout: () => Promise<{
    mode: 'stripe' | 'sandbox' | 'already_pro';
    checkoutUrl?: string;
    sessionId?: string;
  }>;
  onSubmitClaim: (payload: { username: string; note: string }) => Promise<void>;
}

export function UpgradeModal({
  open,
  onClose,
  language,
  billingConfig,
  qrBlobUrl,
  defaultUsername,
  userEmail,
  subscription,
  lockedFeature,
  onCreateCheckout,
  onSubmitClaim,
}: UpgradeModalProps) {
  const t = getTranslations(language);
  const stripeConfigured = Boolean(billingConfig?.stripeConfigured);
  const [payTab, setPayTab] = useState<'qr_whatsapp' | 'stripe'>('qr_whatsapp');
  const [username, setUsername] = useState(
    subscription?.claimUsername || defaultUsername || userEmail
  );
  const [note, setNote] = useState(subscription?.claimNote || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [claimRecorded, setClaimRecorded] = useState(false);
  const [stripeRedirectUrl, setStripeRedirectUrl] = useState('');

  useEffect(() => {
    if (!open) return;
    setUsername((prev) => prev || subscription?.claimUsername || defaultUsername || userEmail);
    setNote((prev) => prev || subscription?.claimNote || '');
    setError('');
    setClaimRecorded(false);
  }, [open, defaultUsername, userEmail, subscription?.claimUsername, subscription?.claimNote]);

  const featureHighlights: Array<{ key: LockedFeatureKey; label: string }> = [
    { key: 'ai_import', label: t.featureAiImport },
    { key: 'taxes', label: t.featureTaxes },
    { key: 'reports', label: t.featureReports },
  ];

  const effectiveUsername = username.trim() || defaultUsername || userEmail;
  const cleanNote = note.trim();
  const whatsappDigits =
    (billingConfig?.whatsappNumber || '255676252116').replace(/\D/g, '') || '255676252116';

  const whatsappMessage =
    language === 'sw'
      ? [
          'Habari, nimelipa $5 (~TZS 13,250) kwa ajili ya FinanceDesk Pro.',
          `Username: ${effectiveUsername}`,
          userEmail ? `Barua pepe: ${userEmail}` : '',
          cleanNote ? `Kumbukumbu: ${cleanNote}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'Hello, I have paid $5 (~TZS 13,250) for FinanceDesk Pro.',
          `Username: ${effectiveUsername}`,
          userEmail ? `Account Email: ${userEmail}` : '',
          cleanNote ? `Payment Ref: ${cleanNote}` : '',
        ]
          .filter(Boolean)
          .join('\n');

  const whatsappUrl = `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(whatsappMessage)}`;

  const handleConfirmWhatsAppClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    setError('');
    if (!username.trim()) {
      e.preventDefault();
      setError(
        language === 'sw'
          ? 'Tafadhali weka username au jina lako kabla ya kuthibitisha.'
          : 'Please enter your username before confirming payment.'
      );
      return;
    }

    setClaimRecorded(true);
    void onSubmitClaim({
      username: username.trim(),
      note: cleanNote,
    }).catch((err) => {
      setError((err as Error).message || 'Could not record payment confirmation.');
    });
  };

  const handleStripeCheckout = async () => {
    setError('');
    setStripeRedirectUrl('');
    setSubmitting(true);
    try {
      const res = await onCreateCheckout();
      if (res.mode === 'already_pro') {
        onClose();
        return;
      }
      if (res.mode === 'stripe' && res.checkoutUrl) {
        setStripeRedirectUrl(res.checkoutUrl);
        try {
          if (window.top && window.top !== window) {
            window.top.location.href = res.checkoutUrl;
          } else {
            window.location.href = res.checkoutUrl;
          }
        } catch {
          // Leave direct link visible if top-frame navigation is restricted
        }
        return;
      }
      setError(t.previewSandboxNote);
    } catch (e) {
      setError((e as Error).message || 'Could not start Stripe Checkout.');
    } finally {
      setSubmitting(false);
    }
  };

  const isPendingVerification =
    claimRecorded || subscription?.claimStatus === 'pending_verification';

  return (
    <Modal open={open} title={t.upgradeTitle} onClose={onClose} size="md">
      <div className="space-y-4">
        <div className="rounded-lg border border-[#2A2A2A] bg-[#0B0B0B] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wider text-[#C1121F] uppercase">
                {t.planProTitle}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[#A5A5A5]">{t.upgradeSubtitle}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono-nums text-2xl font-bold text-white">$5</p>
              <p className="font-mono-nums text-[11px] text-[#8A8A8A]">~TZS 13,250</p>
            </div>
          </div>

          <ul className="mt-3.5 space-y-2 border-t border-[#1E1E1E] pt-3">
            {featureHighlights.map((item) => {
              const isHighlighted = lockedFeature === item.key;
              return (
                <li
                  key={item.key}
                  className={`flex items-start gap-2 text-xs ${
                    isHighlighted ? 'font-semibold text-white' : 'text-[#D0D0D0]'
                  }`}
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C1121F]" />
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {stripeConfigured && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setPayTab('qr_whatsapp');
                setError('');
              }}
              className={`flex min-h-[42px] items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                payTab === 'qr_whatsapp'
                  ? 'border-[#C1121F] bg-[#1F0B0D] text-white'
                  : 'border-[#2A2A2A] bg-[#0B0B0B] text-[#A0A0A0] hover:text-white'
              }`}
            >
              <QrCode className="h-3.5 w-3.5" />
              <span>{t.payMethodQrWhatsApp}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setPayTab('stripe');
                setError('');
              }}
              className={`flex min-h-[42px] items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                payTab === 'stripe'
                  ? 'border-[#C1121F] bg-[#1F0B0D] text-white'
                  : 'border-[#2A2A2A] bg-[#0B0B0B] text-[#A0A0A0] hover:text-white'
              }`}
            >
              <CreditCard className="h-3.5 w-3.5" />
              <span>{t.qrTabStripeOption}</span>
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-md border border-[#7F1D1D] bg-[#200A0C] px-3.5 py-2.5 text-xs text-red-300"
          >
            {error}
          </div>
        )}

        {stripeConfigured && payTab === 'stripe' ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-md border border-[#242424] bg-[#0B0B0B] px-3.5 py-2.5 text-xs text-[#A5A5A5]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <span>{t.stripeLiveNote}</span>
            </p>

            {stripeRedirectUrl && (
              <div className="rounded-md border border-emerald-800/60 bg-emerald-950/30 px-3.5 py-2.5 text-xs text-emerald-200">
                <a
                  href={stripeRedirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline hover:text-white"
                >
                  {language === 'sw'
                    ? 'Fungua ukurasa wa malipo ya Stripe'
                    : 'Continue to Stripe Checkout'}
                </a>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="min-h-[42px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:border-[#C1121F] hover:text-white sm:min-h-0"
              >
                {t.cancelBtn}
              </button>
              <button
                type="button"
                onClick={() => void handleStripeCheckout()}
                disabled={submitting}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-[#C1121F] px-5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#D91A28] disabled:opacity-50 sm:min-h-0"
              >
                <Lock className="h-3.5 w-3.5" />
                {submitting ? t.processingPayment : t.payNowBtn}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Dedicated QR Code Payment Area */}
            <div className="rounded-lg border border-[#262626] bg-[#0B0B0B] p-4">
              <div className="text-center">
                <p className="text-xs font-semibold text-white">{t.qrSectionTitle}</p>
                <p className="mt-1 text-[11px] text-[#9A9A9A]">{t.qrScanHint}</p>
              </div>

              <div className="mt-3.5 flex justify-center">
                {billingConfig?.hasQrCode && qrBlobUrl ? (
                  <div className="rounded-xl border border-[#333333] bg-white p-3 shadow-sm">
                    <img
                      src={qrBlobUrl}
                      alt="FinanceDesk Payment QR Code"
                      className="h-48 w-48 object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex h-48 w-48 flex-col items-center justify-center rounded-xl border border-dashed border-[#383838] bg-[#121212] p-4 text-center">
                    <QrCode className="h-10 w-10 text-[#C1121F]" />
                    <p className="mt-2.5 text-xs font-semibold text-white">
                      {t.qrNotUploadedTitle}
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-[#888888]">
                      {t.qrNotUploadedHint}
                    </p>
                  </div>
                )}
              </div>

              {billingConfig?.paymentInstructions && (
                <div className="mt-3.5 rounded-md border border-[#242424] bg-[#141414] px-3 py-2.5 text-left">
                  <p className="text-[10px] font-semibold tracking-wider text-[#9A9A9A] uppercase">
                    {t.qrInstructionsLabel}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#E5E5E5]">
                    {billingConfig.paymentInstructions}
                  </p>
                </div>
              )}
            </div>

            {isPendingVerification && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-md border border-amber-700/60 bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-200"
              >
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="font-semibold text-amber-100">{t.pendingApprovalTitle}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/90">
                    {t.pendingApprovalBody}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
                <span>{t.qrUsernameLabel}</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t.qrUsernamePlaceholder}
                  className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none sm:text-sm"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-[#9A9A9A]">
                <span>{t.qrNoteLabel}</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t.qrNotePlaceholder}
                  className="h-10 rounded-md border border-[#2A2A2A] bg-[#0B0B0B] px-3 text-base text-white placeholder-[#5C5C5C] focus:border-[#C1121F] focus:outline-none sm:text-sm"
                />
              </label>
            </div>

            <p className="rounded-md border border-[#222222] bg-[#0B0B0B] px-3 py-2 text-[11px] leading-relaxed text-[#8A8A8A]">
              {t.whatsappHelpNote}
            </p>

            <div className="flex flex-col-reverse gap-2 border-t border-[#222222] pt-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] rounded-md border border-[#2C2C2C] px-4 py-2 text-xs font-medium text-[#CCCCCC] hover:border-[#C1121F] hover:text-white sm:min-h-0"
              >
                {t.cancelBtn}
              </button>

              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleConfirmWhatsAppClick}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 sm:min-h-0"
              >
                <MessageCircle className="h-4 w-4 shrink-0" />
                <span>{t.whatsappConfirmBtn}</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
