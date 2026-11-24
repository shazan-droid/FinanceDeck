import type { AppLanguage } from '../types';

export interface Translations {
  // Auth & Session
  verifyingSession: string;
  signInTitle: string;
  signInSubtitle: string;
  signInGoogle: string;
  signingIn: string;
  autoLogoutMsg: string;
  inactivityWarningPrefix: string;
  inactivityWarningSuffix: string;
  staySignedIn: string;
  signOutNow: string;
  signOut: string;
  workspaceSetup: string;
  refreshPrices: string;
  refreshShort: string;
  updating: string;
  upgradeCta: string;
  proBadge: string;

  // Navigation
  navOverview: string;
  navWorkingCapital: string;
  navLongTerm: string;
  navInvestments: string;
  navKhumsTax: string;
  navTaxOnly: string;
  navAdmin: string;
  mobileOverview: string;
  mobileCashFlow: string;
  mobileLongTerm: string;
  mobilePortfolio: string;
  mobileKhums: string;
  mobileTaxes: string;
  mobileAdmin: string;

  // Onboarding
  setupTagline: string;
  setupTitle: string;
  setupSubtitle: string;
  setupLangHeading: string;
  setupLangDesc: string;
  langEnglish: string;
  langSwahili: string;
  setupSec1Title: string;
  khumsTitle: string;
  khumsEnabledDesc: string;
  khumsDisabledDesc: string;
  statusLabel: string;
  khumsStatusOn: string;
  khumsStatusOff: string;
  targetLabel: string;
  targetHint: string;
  setupSec2Title: string;
  annualized: string;
  perYear: string;
  logToLedgerPrefix: string;
  logToLedgerSuffix: string;
  setupSec3Title: string;
  setupPlanDesc: string;
  planFreeTitle: string;
  planFreePrice: string;
  planFreeDesc: string;
  planProTitle: string;
  planProPrice: string;
  planProDesc: string;
  planSelectedProCta: string;
  skipForNow: string;
  savingSetup: string;
  completeSetup: string;

  // Overview
  kpiNetWorth: string;
  kpiWorkingCapital: string;
  kpiPortfolioValue: string;
  kpiPeriodCashFlow: string;
  ofTarget: string;
  currentMinusLiab: string;
  portfolioSub: string;
  periodFrom: string;
  periodTo: string;
  targetNetWorth: string;
  setupAndFixed: string;
  importStatementAi: string;
  autoUpdatePrices: string;
  quickRange: string;
  thisMonth: string;
  lastMonth: string;
  last90Days: string;
  yearToDate: string;
  allDates: string;
  reportsTitle: string;
  reportsSubtitle: string;
  generateAllPdf: string;
  proLockedNotice: string;
  unlockProButton: string;

  // Working Capital & Long Term & Investments
  wcTitleAssets: string;
  wcTitleLedger: string;
  moveBetweenBanks: string;
  monthlyDefaultsBtn: string;
  addEntry: string;
  logTransaction: string;
  ltTitleLedger: string;
  invTitleHoldings: string;
  invTitleIndicators: string;
  addHolding: string;

  // Khums & Taxes Paywall & Controls
  taxesPaywallTitle: string;
  taxesPaywallBody: string;
  taxesPaywallBullets: readonly [string, string, string];
  khumsToggleLabel: string;
  khumsOn: string;
  khumsOff: string;

  // Upgrade / Checkout Modal
  upgradeTitle: string;
  upgradeSubtitle: string;
  featureAiImport: string;
  featureTaxes: string;
  featureReports: string;
  payMethodCard: string;
  payMethodMobile: string;
  mobileProviderLabel: string;
  mobilePhoneLabel: string;
  cardHolderLabel: string;
  cardLast4Label: string;
  payAmountLabel: string;
  payNowBtn: string;
  processingPayment: string;
  cancelBtn: string;
  stripeLiveNote: string;
  previewSandboxNote: string;

  // QR Code & WhatsApp Payment Confirmation
  payMethodQrWhatsApp: string;
  qrSectionTitle: string;
  qrScanHint: string;
  qrNotUploadedTitle: string;
  qrNotUploadedHint: string;
  qrInstructionsLabel: string;
  qrUsernameLabel: string;
  qrUsernamePlaceholder: string;
  qrNoteLabel: string;
  qrNotePlaceholder: string;
  whatsappConfirmBtn: string;
  whatsappHelpNote: string;
  pendingApprovalTitle: string;
  pendingApprovalBody: string;
  qrTabStripeOption: string;

  // Admin Dashboard
  adminTitle: string;
  adminSubtitle: string;
  adminTotalUsers: string;
  adminPaidUsers: string;
  adminPendingUsers: string;
  adminFreeUsers: string;
  adminQrCardTitle: string;
  adminQrCardSubtitle: string;
  adminQrUploadBtn: string;
  adminQrReplaceBtn: string;
  adminQrRemoveBtn: string;
  adminQrEmptyLabel: string;
  adminWhatsappLabel: string;
  adminInstructionsLabel: string;
  adminInstructionsPlaceholder: string;
  adminSaveBillingConfig: string;
  adminAddPaidTitle: string;
  adminAddPaidEmailLabel: string;
  adminAddPaidRefLabel: string;
  adminMakePaidBtn: string;
  adminSetFreeBtn: string;
  adminApproveBtn: string;
  adminUsersTitle: string;
  adminSearchPlaceholder: string;
  adminFilterAll: string;
  adminFilterPending: string;
  adminFilterPaid: string;
  adminFilterFree: string;
  adminNoUsers: string;
  adminStatusPaid: string;
  adminStatusPending: string;
  adminStatusFree: string;
}

const EN: Translations = {
  verifyingSession: 'Verifying session...',
  signInTitle: 'Sign In to FinanceDesk',
  signInSubtitle:
    'Sign in with your Google account to open your own personal Tanzanian Shillings (TZS) wealth ledger, cash flow, bank accounts, and investments. Every account has its own isolated workspace.',
  signInGoogle: 'Sign in with Google',
  signingIn: 'Signing in...',
  autoLogoutMsg: 'You were automatically signed out after 10 minutes of inactivity.',
  inactivityWarningPrefix: 'Your session will sign out automatically in',
  inactivityWarningSuffix: 'due to 10 minutes of inactivity.',
  staySignedIn: 'Stay Signed In',
  signOutNow: 'Sign Out Now',
  signOut: 'Sign Out',
  workspaceSetup: 'Workspace Setup',
  refreshPrices: 'Refresh Prices',
  refreshShort: 'Refresh',
  updating: 'Updating...',
  upgradeCta: 'Upgrade ($5)',
  proBadge: 'PRO',

  navOverview: 'Overview',
  navWorkingCapital: 'Working Capital',
  navLongTerm: 'Long Term',
  navInvestments: 'Investments',
  navKhumsTax: 'Khums & Taxes',
  navTaxOnly: 'Taxes (TRA)',
  navAdmin: 'Admin',
  mobileOverview: 'Overview',
  mobileCashFlow: 'Cash Flow',
  mobileLongTerm: 'Long Term',
  mobilePortfolio: 'Portfolio',
  mobileKhums: 'Khums',
  mobileTaxes: 'Taxes',
  mobileAdmin: 'Admin',

  setupTagline: 'Account Setup',
  setupTitle: 'Configure Your FinanceDesk Workspace',
  setupSubtitle:
    'Pick your preferred language, choose whether to track Khums, fill in your monthly fixed expenses, and select Free or Pro ($5) before opening your dashboard.',
  setupLangHeading: '01. Language / Lugha',
  setupLangDesc: 'Choose the display language for your FinanceDesk workspace.',
  langEnglish: 'English',
  langSwahili: 'Kiswahili',
  setupSec1Title: '02. Khums & Financial Target',
  khumsTitle: 'Khums Calculator (Ayatollah al-Sistani)',
  khumsEnabledDesc: 'Enabled — tracks 20% Khums on annual surplus alongside Tanzania TRA Taxes.',
  khumsDisabledDesc: 'Disabled — hides Khums sections and shows only Tanzania TRA Taxes.',
  statusLabel: 'Status:',
  khumsStatusOn: 'ON (Khums & Taxes)',
  khumsStatusOff: 'OFF (Taxes Only)',
  targetLabel: 'Target Net Worth (TZS)',
  targetHint: 'Benchmark used on your Overview progress chart and Statement of Equity.',
  setupSec2Title: '03. Monthly Fixed Expenses',
  annualized: 'Annualized:',
  perYear: '/ year',
  logToLedgerPrefix: 'Also record these',
  logToLedgerSuffix: "filled expense(s) in today's Cash Flow ledger right away",
  setupSec3Title: '04. Choose Your Plan (Freemium)',
  setupPlanDesc:
    'Core wealth tracking is free forever. Upgrade to Pro for a $5 payment to unlock AI Statement Imports, Khums & TRA Taxes, and PDF/CSV Report Generation.',
  planFreeTitle: 'Free Plan',
  planFreePrice: '$0',
  planFreeDesc: 'Dashboard, cash flow ledger, bank balances, fixed monthly defaults & live DSE/UTT tracking.',
  planProTitle: 'FinanceDesk Pro',
  planProPrice: '$5',
  planProDesc: 'Everything in Free + AI Bank Statement Import, Khums & TRA Tax Calculators, and PDF/CSV Reports.',
  planSelectedProCta: 'Unlock Pro ($5) & Finish Setup',
  skipForNow: 'Skip for now (Free Plan)',
  savingSetup: 'Saving Setup...',
  completeSetup: 'Complete Setup & Open Dashboard',

  kpiNetWorth: 'Net worth',
  kpiWorkingCapital: 'Working capital',
  kpiPortfolioValue: 'Portfolio value',
  kpiPeriodCashFlow: 'Net cash flow (period)',
  ofTarget: 'of target',
  currentMinusLiab: 'Current assets minus liabilities',
  portfolioSub: 'Stocks, ETFs, bonds & UTT AMIS',
  periodFrom: 'Period from',
  periodTo: 'To',
  targetNetWorth: 'Target net worth (TZS)',
  setupAndFixed: 'Setup & Preferences',
  importStatementAi: 'Import Statement (AI)',
  autoUpdatePrices: 'Auto-update prices',
  quickRange: 'Quick range:',
  thisMonth: 'This Month',
  lastMonth: 'Last Month',
  last90Days: 'Last 90 Days',
  yearToDate: 'Year to Date',
  allDates: 'All Dates',
  reportsTitle: 'Financial Statements & Exports',
  reportsSubtitle: 'Formatted PDFs (with expenses pie chart) & spreadsheet CSVs in TZS.',
  generateAllPdf: 'Generate All Reports (PDF Pack)',
  proLockedNotice: 'FinanceDesk Pro ($5) unlocks AI Imports, Khums & TRA Taxes, and PDF/CSV Reports.',
  unlockProButton: 'Unlock Pro — $5',

  wcTitleAssets: 'Current Assets & Liabilities (Bank, Cash & Short-Term)',
  wcTitleLedger: 'Cash Flow Ledger',
  moveBetweenBanks: 'Move Between Banks',
  monthlyDefaultsBtn: 'Monthly Default',
  addEntry: 'Add Entry',
  logTransaction: 'Log Transaction',
  ltTitleLedger: 'Long-Term Balance Sheet Ledger',
  invTitleHoldings: 'Portfolio Holdings (DSE, UTT AMIS & Global)',
  invTitleIndicators: 'Market Indicators & Benchmarks',
  addHolding: 'Add Holding',

  taxesPaywallTitle: 'Unlock Khums & Tanzania TRA Taxes ($5 Pro)',
  taxesPaywallBody:
    'Tax calculations, Ayatollah al-Sistani Khums assessments, and official Tax PDF statements are part of FinanceDesk Pro.',
  taxesPaywallBullets: [
    'Ayatollah al-Sistani Khums Calculator (Year-End Wealth & Income Flow)',
    'Tanzania TRA PAYE progressive slabs, NSSF/PSSSF, DSE Dividends & CGT',
    'One-click Ledger Prefill & Print-ready Khums + TRA PDF Reports',
  ],
  khumsToggleLabel: 'Khums calculator',
  khumsOn: 'ON',
  khumsOff: 'OFF',

  upgradeTitle: 'Upgrade to FinanceDesk Pro',
  upgradeSubtitle: 'One $5 payment unlocks all premium automation, tax, and reporting tools for your account.',
  featureAiImport: 'AI Bank Statement Import & Smart Categorization',
  featureTaxes: 'Khums (Al-Sistani) & Tanzania TRA Tax Calculators',
  featureReports: 'Formatted PDF Financial Statements & CSV Exports',
  payMethodCard: 'Card ($5.00 USD)',
  payMethodMobile: 'Mobile Money (~TZS 13,250)',
  mobileProviderLabel: 'Mobile Money Network',
  mobilePhoneLabel: 'Mobile Number',
  cardHolderLabel: 'Name on Card',
  cardLast4Label: 'Card Number (last 4 or test digits)',
  payAmountLabel: 'Total Due',
  payNowBtn: 'Pay $5 & Unlock Pro',
  processingPayment: 'Processing $5 payment...',
  cancelBtn: 'Cancel',
  stripeLiveNote: 'You will be redirected to secure Stripe Checkout for $5.00 USD.',
  previewSandboxNote:
    'Sandbox Checkout is active because Stripe secret keys are not configured in Environment Secrets yet.',

  payMethodQrWhatsApp: 'QR Code & WhatsApp',
  qrSectionTitle: 'Scan QR Code to Pay $5 (~TZS 13,250)',
  qrScanHint: 'Scan using your mobile money or bank app, then tap the WhatsApp button below to confirm.',
  qrNotUploadedTitle: 'Payment QR Code Space',
  qrNotUploadedHint:
    'The Admin can upload a Lipa Namba / Bank QR code from the Admin Dashboard. You can still confirm payment via WhatsApp below.',
  qrInstructionsLabel: 'Payment Instructions / Lipa Namba',
  qrUsernameLabel: 'Your Username / Account Name',
  qrUsernamePlaceholder: 'Enter your name or username',
  qrNoteLabel: 'Payment Reference / M-Pesa Code (optional)',
  qrNotePlaceholder: 'e.g. MPESA-98A4K2 or Lipa Namba receipt',
  whatsappConfirmBtn: "I've Paid — Confirm on WhatsApp",
  whatsappHelpNote:
    'Tapping opens WhatsApp (+255 676 252 116) with your username and payment confirmation, and notifies the Admin.',
  pendingApprovalTitle: 'Payment Confirmation Sent — Waiting for Admin Activation',
  pendingApprovalBody:
    'Your confirmation claim has been logged. Once the Admin verifies your WhatsApp message, your Pro features unlock automatically.',
  qrTabStripeOption: 'Card (Stripe $5)',

  adminTitle: 'Admin Dashboard',
  adminSubtitle: 'Manage the payment QR code, WhatsApp confirmation number, and manually activate paid $5 Pro customers.',
  adminTotalUsers: 'Total Accounts',
  adminPaidUsers: 'Paid Customers (Pro)',
  adminPendingUsers: 'Pending Approval',
  adminFreeUsers: 'Free Plan',
  adminQrCardTitle: 'Payment QR Code & WhatsApp Settings',
  adminQrCardSubtitle: 'Upload the QR code displayed in the $5 upgrade modal (PNG, JPG, or WEBP up to 2 MB).',
  adminQrUploadBtn: 'Upload QR Code Image',
  adminQrReplaceBtn: 'Replace QR Image',
  adminQrRemoveBtn: 'Remove QR',
  adminQrEmptyLabel: 'No QR code uploaded yet',
  adminWhatsappLabel: 'WhatsApp Confirmation Number',
  adminInstructionsLabel: 'Payment Instructions / Lipa Namba / Account Details',
  adminInstructionsPlaceholder: 'e.g. M-Pesa Lipa Namba 5544332 (FinanceDesk TZ) — TZS 13,250 ($5)',
  adminSaveBillingConfig: 'Save Payment Settings',
  adminAddPaidTitle: 'Manually Mark Email as Paid Customer',
  adminAddPaidEmailLabel: 'Customer Google Email',
  adminAddPaidRefLabel: 'Payment Reference / Note (optional)',
  adminMakePaidBtn: 'Make Paid Customer',
  adminSetFreeBtn: 'Set Free',
  adminApproveBtn: 'Approve & Make Paid',
  adminUsersTitle: 'Customer Accounts',
  adminSearchPlaceholder: 'Search by name, email, username, or reference...',
  adminFilterAll: 'All',
  adminFilterPending: 'Pending',
  adminFilterPaid: 'Paid (Pro)',
  adminFilterFree: 'Free',
  adminNoUsers: 'No customer accounts match your current filter.',
  adminStatusPaid: 'Paid Customer',
  adminStatusPending: 'Pending WhatsApp Check',
  adminStatusFree: 'Free',
};

const SW: Translations = {
  verifyingSession: 'Inahakiki kipindi chako...',
  signInTitle: 'Ingia FinanceDesk',
  signInSubtitle:
    'Ingia kwa akaunti yako ya Google kufungua daftari lako binafsi la utajiri kwa Shilingi za Tanzania (TZS), mtiririko wa fedha, benki na uwekezaji. Kila akaunti ina nafasi yake binafsi.',
  signInGoogle: 'Ingia kwa Google',
  signingIn: 'Inaingia...',
  autoLogoutMsg: 'Ulitolewa kiotomatiki baada ya dakika 10 za kutofanya kazi.',
  inactivityWarningPrefix: 'Kipindi chako kitafungwa kiotomatiki baada ya',
  inactivityWarningSuffix: 'kwa kutofanya kazi kwa dakika 10.',
  staySignedIn: 'Endelea Kuwa Ndani',
  signOutNow: 'Toka Sasa',
  signOut: 'Toka',
  workspaceSetup: 'Usanidi wa Akaunti',
  refreshPrices: 'Sasisha Bei',
  refreshShort: 'Sasisha',
  updating: 'Inasasisha...',
  upgradeCta: 'Boresha ($5)',
  proBadge: 'PRO',

  navOverview: 'Muhtasari',
  navWorkingCapital: 'Mtaji wa Kazi',
  navLongTerm: 'Muda Mrefu',
  navInvestments: 'Uwekezaji',
  navKhumsTax: 'Khums na Kodi',
  navTaxOnly: 'Kodi (TRA)',
  navAdmin: 'Msimamizi',
  mobileOverview: 'Muhtasari',
  mobileCashFlow: 'Fedha',
  mobileLongTerm: 'Muda Mrefu',
  mobilePortfolio: 'Uwekezaji',
  mobileKhums: 'Khums',
  mobileTaxes: 'Kodi',
  mobileAdmin: 'Msimamizi',

  setupTagline: 'Usanidi wa Akaunti',
  setupTitle: 'Sanidi Nafasi Yako ya FinanceDesk',
  setupSubtitle:
    'Chagua lugha unayopendelea, amua kama utatumia Khums, jaza gharama zako za kudumu za kila mwezi, na uchague mpango wa Bure au Pro ($5) kabla ya kufungua dashibodi.',
  setupLangHeading: '01. Lugha / Language',
  setupLangDesc: 'Chagua lugha ya kuonyesha kwenye FinanceDesk yako.',
  langEnglish: 'English',
  langSwahili: 'Kiswahili',
  setupSec1Title: '02. Khums na Lengo la Utajiri',
  khumsTitle: 'Kikokotoo cha Khums (Ayatollah al-Sistani)',
  khumsEnabledDesc: 'Imewashwa — inakokotoa Khums 20% ya ziada ya mwaka pamoja na Kodi za TRA.',
  khumsDisabledDesc: 'Imezimwa — inaficha sehemu za Khums na kuonyesha Kodi za TRA pekee.',
  statusLabel: 'Hali:',
  khumsStatusOn: 'IMEWASHWA (Khums na Kodi)',
  khumsStatusOff: 'IMEZIMWA (Kodi Pekee)',
  targetLabel: 'Lengo la Thamani Halisi (TZS)',
  targetHint: 'Kipimo kinachotumika kwenye chati ya Muhtasari na Taarifa ya Mtaji.',
  setupSec2Title: '03. Gharama za Kudumu za Kila Mwezi',
  annualized: 'Kwa mwaka:',
  perYear: '/ mwaka',
  logToLedgerPrefix: 'Pia rekodi hizi gharama',
  logToLedgerSuffix: 'kwenye daftari la leo la Mtiririko wa Fedha mara moja',
  setupSec3Title: '04. Chagua Mpango Wako (Freemium)',
  setupPlanDesc:
    'Ufuatiliaji wa msingi wa fedha ni bure milele. Boresha kwenda Pro kwa malipo ya $5 kufungua Uingizaji wa Taarifa za Benki kwa AI, Kodi na Khums, na Ripoti za PDF/CSV.',
  planFreeTitle: 'Mpango wa Bure',
  planFreePrice: '$0',
  planFreeDesc: 'Dashibodi, mtiririko wa fedha, salio za benki, gharama za mwezi na bei za DSE/UTT.',
  planProTitle: 'FinanceDesk Pro',
  planProPrice: '$5',
  planProDesc: 'Kila kitu cha Bure + Uingizaji wa Benki kwa AI, Khums & Kodi za TRA, na Ripoti za PDF/CSV.',
  planSelectedProCta: 'Lipa $5 Kufungua Pro na Kamilisha',
  skipForNow: 'Ruka kwa sasa (Mpango wa Bure)',
  savingSetup: 'Inahifadhi Usanidi...',
  completeSetup: 'Kamilisha na Fungua Dashibodi',

  kpiNetWorth: 'Thamani halisi',
  kpiWorkingCapital: 'Mtaji wa kazi',
  kpiPortfolioValue: 'Thamani ya uwekezaji',
  kpiPeriodCashFlow: 'Mtiririko halisi (kipindi)',
  ofTarget: 'ya lengo',
  currentMinusLiab: 'Mali za sasa toa madeni ya sasa',
  portfolioSub: 'Hisa, ETF, hati fungani na UTT AMIS',
  periodFrom: 'Kuanzia tarehe',
  periodTo: 'Hadi',
  targetNetWorth: 'Lengo la thamani halisi (TZS)',
  setupAndFixed: 'Usanidi na Mipangilio',
  importStatementAi: 'Ingiza Taarifa (AI)',
  autoUpdatePrices: 'Sasisha bei kiotomatiki',
  quickRange: 'Kipindi cha haraka:',
  thisMonth: 'Mwezi Huu',
  lastMonth: 'Mwezi Uliopita',
  last90Days: 'Siku 90 Zilizopita',
  yearToDate: 'Mwaka Hadi Sasa',
  allDates: 'Tarehe Zote',
  reportsTitle: 'Taarifa za Kifedha na Ripoti',
  reportsSubtitle: 'PDF zilizopangwa (zenye chati ya matumizi) na CSV kwa TZS.',
  generateAllPdf: 'Tengeneza Ripoti Zote (PDF)',
  proLockedNotice: 'FinanceDesk Pro ($5) inafungua Uingizaji wa AI, Khums na Kodi za TRA, na Ripoti za PDF/CSV.',
  unlockProButton: 'Fungua Pro — $5',

  wcTitleAssets: 'Mali za Sasa na Madeni (Benki, Taslimu na Muda Mfupi)',
  wcTitleLedger: 'Daftari la Mtiririko wa Fedha',
  moveBetweenBanks: 'Hamisha Kati ya Benki',
  monthlyDefaultsBtn: 'Gharama za Mwezi',
  addEntry: 'Ongeza Rekodi',
  logTransaction: 'Rekodi Muamala',
  ltTitleLedger: 'Daftari la Mali na Madeni ya Muda Mrefu',
  invTitleHoldings: 'Uwekezaji Wako (DSE, UTT AMIS na Kimataifa)',
  invTitleIndicators: 'Viashiria vya Soko',
  addHolding: 'Ongeza Hisa/Mfuko',

  taxesPaywallTitle: 'Fungua Khums na Kodi za TRA ($5 Pro)',
  taxesPaywallBody:
    'Kikokotoo cha kodi za TRA, hesabu za Khums (Ayatollah al-Sistani), na ripoti za PDF za kodi zinapatikana kwenye FinanceDesk Pro.',
  taxesPaywallBullets: [
    'Kikokotoo cha Khums cha Ayatollah al-Sistani (Utajiri wa Mwaka au Mapato)',
    'Viwango vya PAYE vya TRA Tanzania, NSSF/PSSSF, Gawio la DSE na CGT',
    'Jaza kiotomatiki kutoka daftari na chapisha Ripoti ya PDF ya Khums + TRA',
  ],
  khumsToggleLabel: 'Kikokotoo cha Khums',
  khumsOn: 'IMEWASHWA',
  khumsOff: 'IMEZIMWA',

  upgradeTitle: 'Boresha Kwenda FinanceDesk Pro',
  upgradeSubtitle: 'Malipo ya mara moja ya $5 yanafungua zana zote za AI, kodi na ripoti za PDF/CSV kwenye akaunti yako.',
  featureAiImport: 'Uingizaji wa Taarifa za Benki na Kupanga kwa AI',
  featureTaxes: 'Vikokotoo vya Khums (Al-Sistani) na Kodi za TRA Tanzania',
  featureReports: 'Taarifa za Kifedha za PDF na Usafirishaji wa CSV',
  payMethodCard: 'Kadi ($5.00 USD)',
  payMethodMobile: 'Pesa kwa Simu (~TZS 13,250)',
  mobileProviderLabel: 'Mtandao wa Simu',
  mobilePhoneLabel: 'Namba ya Simu',
  cardHolderLabel: 'Jina Kwenye Kadi',
  cardLast4Label: 'Namba ya Kadi (tarakimu 4 za mwisho)',
  payAmountLabel: 'Kiasi cha Kulipa',
  payNowBtn: 'Lipa $5 na Fungua Pro',
  processingPayment: 'Inachakata malipo ya $5...',
  cancelBtn: 'Ghairi',
  stripeLiveNote: 'Utaelekezwa kwenye Stripe Checkout salama kulipa $5.00 USD.',
  previewSandboxNote:
    'Malipo ya majaribio (Sandbox) yanatumika kwa sababu ufunguo wa Stripe haujawekwa bado.',

  payMethodQrWhatsApp: 'QR Code & WhatsApp',
  qrSectionTitle: 'Changanua QR Code Kulipa $5 (~TZS 13,250)',
  qrScanHint: 'Changanua kwa app ya simu au benki yako, kisha gusa kitufe cha WhatsApp hapo chini kuthibitisha.',
  qrNotUploadedTitle: 'Eneo la QR Code ya Malipo',
  qrNotUploadedHint:
    'Msimamizi anaweza kupakia picha ya QR Code ya Lipa Namba kutoka Dashibodi ya Msimamizi. Bado unaweza kuthibitisha malipo kupitia WhatsApp.',
  qrInstructionsLabel: 'Maelekezo ya Malipo / Lipa Namba',
  qrUsernameLabel: 'Jina Lako la Mtumiaji (Username)',
  qrUsernamePlaceholder: 'Weka jina lako au username',
  qrNoteLabel: 'Namba ya Kumbukumbu / Risiti ya M-Pesa (hiari)',
  qrNotePlaceholder: 'mfano MPESA-98A4K2 au risiti ya Lipa Namba',
  whatsappConfirmBtn: 'Nimelipa — Thibitisha WhatsApp',
  whatsappHelpNote:
    'Kugusa kutafungua WhatsApp (+255 676 252 116) ikiwa na jina lako na uthibitisho wa malipo, na kumjulisha Msimamizi.',
  pendingApprovalTitle: 'Uthibitisho Umetumwa — Inasubiri Idhini ya Msimamizi',
  pendingApprovalBody:
    'Ombi lako la uthibitisho limesajiliwa. Msimamizi akihakiki ujumbe wako wa WhatsApp, vipengele vya Pro vitafunguliwa.',
  qrTabStripeOption: 'Kadi (Stripe $5)',

  adminTitle: 'Dashibodi ya Msimamizi',
  adminSubtitle: 'Simamia picha ya QR code ya malipo, namba ya WhatsApp, na washa wateja waliolipa $5 Pro kwa mikono.',
  adminTotalUsers: 'Akaunti Zote',
  adminPaidUsers: 'Wateja Waliolipa (Pro)',
  adminPendingUsers: 'Wanaosubiri Idhini',
  adminFreeUsers: 'Mpango wa Bure',
  adminQrCardTitle: 'QR Code ya Malipo na Mipangilio ya WhatsApp',
  adminQrCardSubtitle: 'Pakia QR code inayoonekana kwenye dirisha la malipo ya $5 (PNG, JPG, au WEBP hadi 2 MB).',
  adminQrUploadBtn: 'Pakia Picha ya QR Code',
  adminQrReplaceBtn: 'Badilisha Picha ya QR',
  adminQrRemoveBtn: 'Ondoa QR',
  adminQrEmptyLabel: 'Hakuna QR code iliyopakiwa bado',
  adminWhatsappLabel: 'Namba ya WhatsApp ya Uthibitisho',
  adminInstructionsLabel: 'Maelekezo ya Malipo / Lipa Namba / Akaunti',
  adminInstructionsPlaceholder: 'mfano M-Pesa Lipa Namba 5544332 (FinanceDesk TZ) — TZS 13,250 ($5)',
  adminSaveBillingConfig: 'Hifadhi Mipangilio ya Malipo',
  adminAddPaidTitle: 'Weka Barua Pepe Kuwa Mteja Aliyelipa',
  adminAddPaidEmailLabel: 'Barua Pepe ya Google ya Mteja',
  adminAddPaidRefLabel: 'Kumbukumbu ya Malipo (hiari)',
  adminMakePaidBtn: 'Mfanye Mteja Aliyelipa',
  adminSetFreeBtn: 'Rudisha Bure',
  adminApproveBtn: 'Idhinisha & Fanya Mteja',
  adminUsersTitle: 'Akaunti za Wateja',
  adminSearchPlaceholder: 'Tafuta kwa jina, barua pepe, au kumbukumbu...',
  adminFilterAll: 'Wote',
  adminFilterPending: 'Wanaosubiri',
  adminFilterPaid: 'Waliolipa (Pro)',
  adminFilterFree: 'Bure',
  adminNoUsers: 'Hakuna akaunti zinazolingana na kichujio hiki.',
  adminStatusPaid: 'Mteja Aliyelipa',
  adminStatusPending: 'Inasubiri Uhakiki wa WhatsApp',
  adminStatusFree: 'Bure',
};

export function getTranslations(lang: AppLanguage | undefined): Translations {
  return lang === 'sw' ? SW : EN;
}
