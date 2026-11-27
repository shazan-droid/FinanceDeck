import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GoogleGenAI, Type, type GenerateContentResponse } from '@google/genai';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response as ExpressResponse } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const LEGACY_OWNER_EMAIL = 'syedshazanrizvi@gmail.com';
const DEFAULT_WHATSAPP_NUMBER = '255676252116';
const MEMBERSHIP_DURATION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ADMIN_EMAIL_SET = new Set<string>(
  [LEGACY_OWNER_EMAIL, ...(process.env.ADMIN_EMAILS || '').split(',')]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const USERS_DATA_DIR = path.join(DATA_DIR, 'users');
const PLATFORM_DB_PATH = path.join(DATA_DIR, 'platform.db');
const MEMBERS_DB_PATH = path.join(DATA_DIR, 'members.db');
const PLATFORM_QR_DIR = path.join(DATA_DIR, 'platform-qr');
const LEGACY_DB_PATH = path.join(DATA_DIR, 'financedesk.db');
const LEGACY_RECEIPTS_DIR = path.join(DATA_DIR, 'receipts');

function isAdminEmail(email: string): boolean {
  return Boolean(email) && ADMIN_EMAIL_SET.has(email.trim().toLowerCase());
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
};

const VALID_SECTIONS = new Set([
  'current_asset',
  'current_liability',
  'longterm_asset',
  'longterm_liability',
]);
const VALID_ACTIVITIES = new Set(['operating', 'investing', 'financing']);
const VALID_SOURCES = new Set([
  'DSE',
  'UTT AMIS',
  'Fixed',
  'Yahoo',
  'StockAnalysis',
  'Investing.com',
  'Web',
  'Manual',
]);

// Initialize Firebase Admin (projectId only — verifyIdToken requires no IAM role)
function initFirebaseAdmin() {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { projectId?: string };
  if (!raw.projectId || raw.projectId === 'remixed-project-id') {
    throw new Error('Firebase projectId is missing in firebase-applet-config.json');
  }
  return getApps().length ? getApp() : initializeApp({ projectId: raw.projectId });
}

const adminApp = initFirebaseAdmin();

interface UserContext {
  uid: string;
  email: string;
  displayName: string;
  db: DatabaseSync;
  receiptsDir: string;
}

interface AuthenticatedRequest extends Request {
  userContext?: UserContext;
}

function isValidUid(uid: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(uid);
}

const userDbCache = new Map<string, DatabaseSync>();
const dbToEmailMap = new WeakMap<DatabaseSync, string>();
let platformDbInstance: DatabaseSync | null = null;
let membersDbInstance: DatabaseSync | null = null;

function addDaysIso(base: string | Date, days: number): string {
  const baseMs = typeof base === 'string' ? Date.parse(base) : base.getTime();
  const startMs = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(startMs + days * MS_PER_DAY).toISOString();
}

function computeDaysRemaining(expiresAt: string): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / MS_PER_DAY);
}

function getPlatformDb(): DatabaseSync {
  if (platformDbInstance) return platformDbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PLATFORM_QR_DIR, { recursive: true });
  const pdb = new DatabaseSync(PLATFORM_DB_PATH);
  pdb.exec(`
    CREATE TABLE IF NOT EXISTS platform_config (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);
  const initCfg = pdb.prepare('INSERT OR IGNORE INTO platform_config (k, v) VALUES (?, ?)');
  initCfg.run('whatsappNumber', DEFAULT_WHATSAPP_NUMBER);
  initCfg.run('paymentInstructions', '');
  initCfg.run('qrFilename', '');
  initCfg.run('qrMime', '');
  initCfg.run('qrUpdatedAt', '');
  platformDbInstance = pdb;
  return pdb;
}

interface MemberSqlRow {
  email: string;
  uid: string;
  display_name: string;
  membership_status: string;
  payment_status: string;
  payment_provider: string;
  payment_ref: string;
  payer_hint: string;
  claim_username: string;
  claim_note: string;
  claimed_at: string;
  paid_at: string;
  expires_at: string;
  last_seen_at: string;
  created_at: string;
}

// Dedicated SQL database for essential member records & membership status only (no financial data)
function getMembersDb(): DatabaseSync {
  if (membersDbInstance) return membersDbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const mdb = new DatabaseSync(MEMBERS_DB_PATH);
  mdb.exec(`
    CREATE TABLE IF NOT EXISTS members (
      email TEXT PRIMARY KEY,
      uid TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      membership_status TEXT NOT NULL DEFAULT 'free',
      payment_status TEXT NOT NULL DEFAULT 'none',
      payment_provider TEXT NOT NULL DEFAULT 'none',
      payment_ref TEXT NOT NULL DEFAULT '',
      payer_hint TEXT NOT NULL DEFAULT '',
      claim_username TEXT NOT NULL DEFAULT '',
      claim_note TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureColumn(mdb, 'members', 'expires_at', "TEXT NOT NULL DEFAULT ''");

  // One-time migration of any existing legacy platform_users rows into dedicated members.db
  try {
    const pdb = getPlatformDb();
    const hasLegacyTable = pdb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'platform_users'")
      .get() as { name: string } | undefined;
    if (hasLegacyTable) {
      const legacyRows = pdb
        .prepare(
          `SELECT email, uid, display_name, plan, payment_status, payment_provider, payment_ref, payer_hint,
                  claim_username, claim_note, claimed_at, paid_at, last_seen_at, created_at
           FROM platform_users`
        )
        .all() as Array<{
        email: string;
        uid: string;
        display_name: string;
        plan: string;
        payment_status: string;
        payment_provider: string;
        payment_ref: string;
        payer_hint: string;
        claim_username: string;
        claim_note: string;
        claimed_at: string;
        paid_at: string;
        last_seen_at: string;
        created_at: string;
      }>;
      const insertMember = mdb.prepare(
        `INSERT OR IGNORE INTO members (
           email, uid, display_name, membership_status, payment_status, payment_provider, payment_ref,
           payer_hint, claim_username, claim_note, claimed_at, paid_at, expires_at, last_seen_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of legacyRows) {
        const isPro = r.plan === 'pro';
        const paidAt = r.paid_at || (isPro ? r.created_at || new Date().toISOString() : '');
        const expiresAt = isPro ? addDaysIso(paidAt, MEMBERSHIP_DURATION_DAYS) : '';
        insertMember.run(
          String(r.email || '').trim().toLowerCase(),
          r.uid || '',
          r.display_name || '',
          isPro ? 'pro' : 'free',
          r.payment_status || (isPro ? 'paid' : 'none'),
          r.payment_provider || 'none',
          r.payment_ref || '',
          r.payer_hint || '',
          r.claim_username || '',
          r.claim_note || '',
          r.claimed_at || '',
          paidAt,
          expiresAt,
          r.last_seen_at || '',
          r.created_at || new Date().toISOString()
        );
      }
    }
  } catch {
    // Non-fatal if no legacy table exists
  }

  membersDbInstance = mdb;
  return mdb;
}

function enforceMemberExpiryRow(mdb: DatabaseSync, row: MemberSqlRow): MemberSqlRow {
  if (row.membership_status !== 'pro') return row;
  const fallbackBase = row.paid_at || row.created_at || new Date().toISOString();
  const effectiveExpiresAt =
    row.expires_at && Number.isFinite(Date.parse(row.expires_at))
      ? row.expires_at
      : addDaysIso(fallbackBase, MEMBERSHIP_DURATION_DAYS);

  if (effectiveExpiresAt !== row.expires_at) {
    mdb
      .prepare('UPDATE members SET expires_at = ? WHERE LOWER(email) = ?')
      .run(effectiveExpiresAt, row.email.toLowerCase());
  }

  const expiresMs = Date.parse(effectiveExpiresAt);
  if (Number.isFinite(expiresMs) && Date.now() >= expiresMs) {
    mdb
      .prepare(
        `UPDATE members
         SET membership_status = 'free',
             payment_status = 'expired'
         WHERE LOWER(email) = ?`
      )
      .run(row.email.toLowerCase());
    return {
      ...row,
      membership_status: 'free',
      payment_status: 'expired',
      expires_at: effectiveExpiresAt,
    };
  }
  return { ...row, expires_at: effectiveExpiresAt };
}

function sweepExpiredMembers(mdb = getMembersDb()): void {
  const proRows = mdb
    .prepare("SELECT * FROM members WHERE membership_status = 'pro'")
    .all() as unknown as MemberSqlRow[];
  for (const row of proRows) {
    enforceMemberExpiryRow(mdb, row);
  }
}

function getPlatformBillingConfig() {
  const pdb = getPlatformDb();
  const rows = pdb.prepare('SELECT k, v FROM platform_config').all() as Array<{ k: string; v: string }>;
  const map = new Map(rows.map((r) => [r.k, r.v]));
  const qrFilename = String(map.get('qrFilename') || '').trim();
  const qrMime = String(map.get('qrMime') || '').trim();
  const qrUpdatedAt = String(map.get('qrUpdatedAt') || '').trim();
  const resolvedQr = qrFilename ? safeResolveQrPath(qrFilename) : null;
  const hasQrCode = Boolean(resolvedQr && fs.existsSync(resolvedQr));
  const rawWa = String(map.get('whatsappNumber') || DEFAULT_WHATSAPP_NUMBER).replace(/\D/g, '');
  const whatsappNumber = rawWa.length >= 8 && rawWa.length <= 15 ? rawWa : DEFAULT_WHATSAPP_NUMBER;
  const paymentInstructions = String(map.get('paymentInstructions') || '');
  return {
    qrFilename: hasQrCode ? qrFilename : '',
    qrMime: hasQrCode ? qrMime : '',
    hasQrCode,
    qrUpdatedAt: hasQrCode ? qrUpdatedAt : '',
    whatsappNumber,
    paymentInstructions,
  };
}

function safeResolveQrPath(filename: string): string | null {
  const clean = filename.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(clean) || clean.includes('..')) {
    return null;
  }
  const resolved = path.resolve(PLATFORM_QR_DIR, clean);
  if (!resolved.startsWith(PLATFORM_QR_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

function listAdminUserRecords() {
  const mdb = getMembersDb();
  sweepExpiredMembers(mdb);
  const rows = mdb
    .prepare(
      `SELECT email, uid, display_name, membership_status, payment_status, payment_provider, payment_ref, payer_hint,
              claim_username, claim_note, claimed_at, paid_at, expires_at, last_seen_at, created_at
       FROM members
       ORDER BY
         CASE payment_status WHEN 'pending_verification' THEN 0 WHEN 'paid' THEN 1 WHEN 'expired' THEN 2 ELSE 3 END ASC,
         COALESCE(NULLIF(claimed_at, ''), NULLIF(last_seen_at, ''), created_at) DESC,
         email ASC`
    )
    .all() as unknown as MemberSqlRow[];

  return rows.map((r) => {
    const isPro = r.membership_status === 'pro';
    const paymentStatus: PaymentClaimStatus = isPro
      ? 'paid'
      : r.payment_status === 'pending_verification'
        ? 'pending_verification'
        : r.payment_status === 'expired'
          ? 'expired'
          : 'none';
    return {
      email: r.email,
      uid: r.uid,
      displayName: r.display_name,
      plan: (isPro ? 'pro' : 'free') as PlanTier,
      paymentStatus,
      paymentProvider: sanitizeProvider(r.payment_provider),
      paymentRef: r.payment_ref,
      payerHint: r.payer_hint,
      claimUsername: r.claim_username,
      claimNote: r.claim_note,
      claimedAt: r.claimed_at,
      paidAt: r.paid_at,
      expiresAt: r.expires_at,
      daysRemaining: isPro ? computeDaysRemaining(r.expires_at) : 0,
      lastSeenAt: r.last_seen_at,
      createdAt: r.created_at,
    };
  });
}

function syncMemberOnAuth(
  uid: string,
  email: string,
  displayName: string,
  userDb: DatabaseSync
): void {
  const normEmail = email.trim().toLowerCase();
  if (!normEmail) return;
  const mdb = getMembersDb();
  const now = new Date().toISOString();
  const existing = mdb
    .prepare('SELECT * FROM members WHERE LOWER(email) = ?')
    .get(normEmail) as MemberSqlRow | undefined;

  if (!existing) {
    const localSubRow = userDb
      .prepare("SELECT v FROM settings WHERE k = 'subscriptionJson'")
      .get() as { v: string } | undefined;
    let localSub: SubscriptionRecord = { ...DEFAULT_SUBSCRIPTION };
    if (localSubRow?.v) {
      try {
        localSub = sanitizeSubscription(JSON.parse(localSubRow.v));
      } catch {
        localSub = { ...DEFAULT_SUBSCRIPTION };
      }
    }
    const isPro = localSub.plan === 'pro';
    const paidAt = isPro ? localSub.paidAt || now : '';
    const expiresAt = isPro ? localSub.expiresAt || addDaysIso(paidAt, MEMBERSHIP_DURATION_DAYS) : '';
    const stillActive = isPro && (!expiresAt || Date.parse(expiresAt) > Date.now());
    mdb
      .prepare(
        `INSERT INTO members (
           email, uid, display_name, membership_status, payment_status, payment_provider, payment_ref,
           payer_hint, claim_username, claim_note, claimed_at, paid_at, expires_at, last_seen_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        normEmail,
        uid,
        displayName.slice(0, 120),
        stillActive ? 'pro' : 'free',
        stillActive ? 'paid' : isPro ? 'expired' : 'none',
        localSub.paymentProvider,
        localSub.paymentRef,
        localSub.payerHint,
        '',
        '',
        '',
        paidAt,
        expiresAt,
        now,
        now
      );
  } else {
    mdb
      .prepare(
        `UPDATE members
         SET uid = COALESCE(NULLIF(?, ''), uid),
             display_name = CASE WHEN ? != '' THEN ? ELSE display_name END,
             last_seen_at = ?
         WHERE LOWER(email) = ?`
      )
      .run(uid, displayName.slice(0, 120), displayName.slice(0, 120), now, normEmail);
    enforceMemberExpiryRow(mdb, existing);
  }
}

function copyDirFilesIfExists(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      const srcFile = path.join(srcDir, entry.name);
      const destFile = path.join(destDir, entry.name);
      if (!fs.existsSync(destFile)) {
        fs.copyFileSync(srcFile, destFile);
      }
    }
  }
}

function migrateLegacyDataIfEligible(email: string, userDbPath: string, userReceiptsDir: string): void {
  if (email.toLowerCase() !== LEGACY_OWNER_EMAIL) return;
  if (fs.existsSync(userDbPath) || !fs.existsSync(LEGACY_DB_PATH)) return;

  fs.mkdirSync(path.dirname(userDbPath), { recursive: true });
  fs.copyFileSync(LEGACY_DB_PATH, userDbPath);
  for (const suffix of ['-wal', '-shm']) {
    const srcSidecar = `${LEGACY_DB_PATH}${suffix}`;
    if (fs.existsSync(srcSidecar)) {
      fs.copyFileSync(srcSidecar, `${userDbPath}${suffix}`);
    }
  }
  copyDirFilesIfExists(LEGACY_RECEIPTS_DIR, userReceiptsDir);
}

function getOrCreateUserContext(uid: string, email: string, displayName = ''): UserContext {
  if (!isValidUid(uid)) {
    throw new Error('Invalid authenticated user identifier');
  }
  const normEmail = email.trim().toLowerCase();
  fs.mkdirSync(USERS_DATA_DIR, { recursive: true });
  const userDir = path.resolve(USERS_DATA_DIR, uid);
  if (!userDir.startsWith(USERS_DATA_DIR + path.sep)) {
    throw new Error('Invalid user storage path');
  }
  const userDbPath = path.join(userDir, 'financedesk.db');
  const userReceiptsDir = path.join(userDir, 'receipts');
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(userReceiptsDir, { recursive: true });

  migrateLegacyDataIfEligible(normEmail, userDbPath, userReceiptsDir);

  let dbInstance = userDbCache.get(uid);
  if (!dbInstance) {
    dbInstance = initDatabase(userDbPath, userReceiptsDir, {
      seedFixedStarter: false,
      email: normEmail,
    });
    userDbCache.set(uid, dbInstance);
  }
  dbToEmailMap.set(dbInstance, normEmail);
  syncMemberOnAuth(uid, normEmail, displayName, dbInstance);
  return {
    uid,
    email: normEmail,
    displayName,
    db: dbInstance,
    receiptsDir: userReceiptsDir,
  };
}

function getRequestUserContext(req: Request): UserContext {
  const ctx = (req as AuthenticatedRequest).userContext;
  if (!ctx) {
    throw new Error('Missing authenticated user context');
  }
  return ctx;
}

function requireAdminUser(req: Request, res: ExpressResponse): UserContext | null {
  const ctx = getRequestUserContext(req);
  if (!isAdminEmail(ctx.email)) {
    res.status(403).json({ error: 'Admin access required.' });
    return null;
  }
  return ctx;
}

async function requireUserAuth(req: Request, res: ExpressResponse, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication token missing' });
    return;
  }
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();
    const displayName = typeof decoded.name === 'string' ? decoded.name.trim() : '';
    if (!email || decoded.email_verified !== true || !isValidUid(decoded.uid)) {
      res.status(403).json({
        error: 'Sign in with a verified Google email account to access FinanceDesk',
      });
      return;
    }
    (req as AuthenticatedRequest).userContext = getOrCreateUserContext(decoded.uid, email, displayName);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication session' });
  }
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

interface MonthlyFixedExpenseItem {
  id: string;
  category: string;
  description: string;
  amount: number;
}

function getDefaultMonthlyFixedExpenses(useLegacyAmounts: boolean): MonthlyFixedExpenseItem[] {
  return [
    { id: 'rent', category: 'Rent', description: 'Rent', amount: useLegacyAmounts ? 90000 : 0 },
    {
      id: 'water',
      category: 'Utilities & data',
      description: 'Water',
      amount: useLegacyAmounts ? 5000 : 0,
    },
    {
      id: 'luku',
      category: 'Utilities & data',
      description: 'Luku',
      amount: useLegacyAmounts ? 30000 : 0,
    },
    { id: 'gym', category: 'Health', description: 'Gym', amount: useLegacyAmounts ? 90000 : 0 },
    {
      id: 'food',
      category: 'Food & groceries',
      description: 'Food + Fruits',
      amount: useLegacyAmounts ? 100000 : 0,
    },
    {
      id: 'wifi',
      category: 'Utilities & data',
      description: 'WiFi',
      amount: useLegacyAmounts ? 37500 : 0,
    },
    { id: 'maid', category: 'Other', description: 'Maid', amount: useLegacyAmounts ? 50000 : 0 },
  ];
}

function sanitizeMonthlyFixedExpenses(raw: unknown): MonthlyFixedExpenseItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MonthlyFixedExpenseItem[] = [];
  for (let i = 0; i < raw.length && out.length < 25; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const desc = String(rec.description ?? '').trim().slice(0, 120);
    if (!desc) continue;
    const cat = String(rec.category ?? 'Other').trim().slice(0, 80) || 'Other';
    const rawId = String(rec.id ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
    const num = Number(rec.amount);
    const amount = Number.isFinite(num) && num >= 0 ? Math.min(num, 1e14) : 0;
    out.push({
      id: rawId || `exp-${i + 1}`,
      category: cat,
      description: desc,
      amount,
    });
  }
  return out;
}

type AppLanguage = 'en' | 'sw';
type PlanTier = 'free' | 'pro';
type PaymentProvider =
  | 'none'
  | 'stripe'
  | 'mobile_money'
  | 'card_preview'
  | 'qr_whatsapp'
  | 'admin_manual';
type PaymentClaimStatus = 'none' | 'pending_verification' | 'paid' | 'expired';

interface SubscriptionRecord {
  plan: PlanTier;
  paidAmountUsd: number;
  paymentProvider: PaymentProvider;
  paymentRef: string;
  payerHint: string;
  paidAt: string;
  expiresAt: string;
  daysRemaining: number | null;
  claimStatus: PaymentClaimStatus;
  claimUsername: string;
  claimNote: string;
  claimedAt: string;
}

const DEFAULT_SUBSCRIPTION: SubscriptionRecord = {
  plan: 'free',
  paidAmountUsd: 0,
  paymentProvider: 'none',
  paymentRef: '',
  payerHint: '',
  paidAt: '',
  expiresAt: '',
  daysRemaining: null,
  claimStatus: 'none',
  claimUsername: '',
  claimNote: '',
  claimedAt: '',
};

function sanitizeProvider(raw: unknown): PaymentProvider {
  const providerRaw = String(raw || 'none');
  if (
    providerRaw === 'stripe' ||
    providerRaw === 'mobile_money' ||
    providerRaw === 'card_preview' ||
    providerRaw === 'qr_whatsapp' ||
    providerRaw === 'admin_manual'
  ) {
    return providerRaw;
  }
  return 'none';
}

function normalizeLanguage(val: unknown): AppLanguage {
  return val === 'sw' ? 'sw' : 'en';
}

function sanitizeSubscription(raw: unknown): SubscriptionRecord {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SUBSCRIPTION };
  const rec = raw as Record<string, unknown>;
  const paymentProvider = sanitizeProvider(rec.paymentProvider);
  const paidAmountUsd = Number(rec.paidAmountUsd || 0);
  const paymentRef = String(rec.paymentRef || '').trim().slice(0, 80);
  const payerHint = String(rec.payerHint || '').trim().slice(0, 60);
  const paidAt = String(rec.paidAt || '').trim().slice(0, 64);
  const expiresAt = String(rec.expiresAt || '').trim().slice(0, 64);
  const claimStatusRaw = String(rec.claimStatus || 'none');
  const claimStatus: PaymentClaimStatus =
    claimStatusRaw === 'pending_verification' ||
    claimStatusRaw === 'paid' ||
    claimStatusRaw === 'expired'
      ? claimStatusRaw
      : 'none';
  const claimUsername = String(rec.claimUsername || '').trim().slice(0, 100);
  const claimNote = String(rec.claimNote || '').trim().slice(0, 160);
  const claimedAt = String(rec.claimedAt || '').trim().slice(0, 64);

  const isExpired = Boolean(expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now());

  if (
    !isExpired &&
    rec.plan === 'pro' &&
    Number.isFinite(paidAmountUsd) &&
    paidAmountUsd >= 5 &&
    paymentProvider !== 'none' &&
    paymentRef.length >= 6
  ) {
    const resolvedExpiresAt = expiresAt || addDaysIso(paidAt || new Date().toISOString(), MEMBERSHIP_DURATION_DAYS);
    return {
      plan: 'pro',
      paidAmountUsd,
      paymentProvider,
      paymentRef,
      payerHint,
      paidAt: paidAt || new Date().toISOString(),
      expiresAt: resolvedExpiresAt,
      daysRemaining: computeDaysRemaining(resolvedExpiresAt),
      claimStatus: 'paid',
      claimUsername,
      claimNote,
      claimedAt,
    };
  }
  return {
    ...DEFAULT_SUBSCRIPTION,
    paidAt: isExpired ? paidAt : '',
    expiresAt: isExpired ? expiresAt : '',
    daysRemaining: isExpired ? 0 : null,
    claimStatus:
      isExpired
        ? 'expired'
        : claimStatus === 'pending_verification'
          ? 'pending_verification'
          : claimStatus === 'expired'
            ? 'expired'
            : 'none',
    claimUsername,
    claimNote,
    claimedAt,
  };
}

function resolveSafeAppOrigin(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.origin;
      }
    } catch {
      // Fallback to request host
    }
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : req.protocol;
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || '')
    .split(',')[0]
    .trim();
  if (host && /^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(host)) {
    return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  }
  return `http://localhost:${PORT}`;
}

function initDatabase(
  dbPath: string,
  receiptsDir: string,
  options?: { seedFixedStarter?: boolean; email?: string }
): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(receiptsDir, { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      activity TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      native_currency TEXT NOT NULL DEFAULT 'TZS',
      receipt_id TEXT NOT NULL DEFAULT '',
      receipt_name TEXT NOT NULL DEFAULT '',
      receipt_mime TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS balance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      native_currency TEXT NOT NULL DEFAULT 'TZS'
    );
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      kind TEXT NOT NULL,
      units REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      updated TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'DSE',
      url TEXT NOT NULL DEFAULT '',
      selector TEXT NOT NULL DEFAULT '',
      regex TEXT NOT NULL DEFAULT '',
      native_currency TEXT NOT NULL DEFAULT 'TZS'
    );
    CREATE TABLE IF NOT EXISTS indicators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      selector TEXT NOT NULL DEFAULT '',
      regex TEXT NOT NULL DEFAULT '',
      value TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS settings (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
  `);

  ensureColumn(db, 'transactions', 'native_currency', "TEXT NOT NULL DEFAULT 'TZS'");
  ensureColumn(db, 'transactions', 'receipt_id', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'transactions', 'receipt_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'transactions', 'receipt_mime', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'balance', 'native_currency', "TEXT NOT NULL DEFAULT 'TZS'");
  ensureColumn(db, 'holdings', 'native_currency', "TEXT NOT NULL DEFAULT 'TZS'");

  const getSetting = (k: string): string | undefined => {
    const r = db.prepare('SELECT v FROM settings WHERE k = ?').get(k) as { v: string } | undefined;
    return r?.v;
  };
  const setSetting = db.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)');

  const hasSettings = db.prepare('SELECT COUNT(*) AS c FROM settings').get() as { c: number };
  if (hasSettings.c === 0) {
    setSetting.run('currency', 'TZS');
    setSetting.run('target', '100000000');
    setSetting.run('autoRefreshOnOpen', 'true');
  } else {
    if (getSetting('currency') !== 'TZS') {
      setSetting.run('currency', 'TZS');
    }
    const existingTarget = Number(getSetting('target') || 100000000);
    if (!Number.isFinite(existingTarget) || existingTarget <= 0 || existingTarget === 150000000) {
      setSetting.run('target', '100000000');
    }
    if (getSetting('autoRefreshOnOpen') === undefined) {
      setSetting.run('autoRefreshOnOpen', 'true');
    }
    db.prepare("DELETE FROM settings WHERE k IN ('ugx_default_applied', 'tzsToUgxRate', 'fxUpdated')").run();
  }

  const hasBal = (db.prepare('SELECT COUNT(*) AS c FROM balance').get() as { c: number }).c > 0;
  const hasTx = (db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c > 0;
  const hasActiveHoldings =
    (db.prepare('SELECT COUNT(*) AS c FROM holdings WHERE units > 0').get() as { c: number }).c > 0;
  const hasKhumsCfg = getSetting('khumsTaxConfig') !== undefined;
  const isLegacyOwner = (options?.email || '').toLowerCase() === LEGACY_OWNER_EMAIL;
  const hasPriorActivity = hasBal || hasTx || hasActiveHoldings || hasKhumsCfg || isLegacyOwner;

  if (getSetting('onboardingCompleted') === undefined) {
    setSetting.run('onboardingCompleted', hasPriorActivity ? 'true' : 'false');
  }
  if (getSetting('khumsEnabled') === undefined) {
    setSetting.run('khumsEnabled', 'true');
  }
  if (getSetting('language') === undefined) {
    setSetting.run('language', 'en');
  }
  if (options?.email) {
    setSetting.run('accountEmail', options.email.trim().toLowerCase());
  }
  if (getSetting('plan') === undefined) {
    setSetting.run('plan', 'free');
  }
  if (getSetting('subscriptionJson') === undefined) {
    setSetting.run('subscriptionJson', JSON.stringify(DEFAULT_SUBSCRIPTION));
  }
  if (getSetting('monthlyFixedExpenses') === undefined) {
    setSetting.run(
      'monthlyFixedExpenses',
      JSON.stringify(getDefaultMonthlyFixedExpenses(hasPriorActivity))
    );
  }

  db.prepare("DELETE FROM indicators WHERE regex = 'FX_TZS_UGX'").run();

  const hasHoldings = db.prepare('SELECT COUNT(*) AS c FROM holdings').get() as { c: number };
  if (hasHoldings.c === 0) {
    seedStarterHoldings(db, options?.seedFixedStarter ?? false);
  }

  const hasIndicators = db.prepare('SELECT COUNT(*) AS c FROM indicators').get() as { c: number };
  if (hasIndicators.c === 0) {
    const insertInd = db.prepare(
      'INSERT INTO indicators (name, url, selector, regex, value, updated) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const uttUrl = 'https://uttamis.co.tz/uttamis2023/uttz/public/index.php';
    const dseUrl = 'https://dse.co.tz/en/all-equities';
    insertInd.run('UTT AMIS Liquid Fund (NAV)', uttUrl, '', 'UTT_LIQUID', '-', '');
    insertInd.run('UTT AMIS Umoja Fund (NAV)', uttUrl, '', 'UTT_UMOJA', '-', '');
    insertInd.run('UTT AMIS Bond Fund (NAV)', uttUrl, '', 'UTT_BOND', '-', '');
    insertInd.run('DSE — CRDB Bank', dseUrl, '', 'DSE_CRDB', '-', '');
  }

  return db;
}

function seedStarterHoldings(db: DatabaseSync, includeFixedStarter = false): void {
  const today = todayIso();
  const existsStmt = db.prepare('SELECT id FROM holdings WHERE LOWER(symbol) = LOWER(?)');
  const insertStmt = db.prepare(`
    INSERT INTO holdings (symbol, kind, units, cost, price, updated, date, source, url, selector, regex, native_currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const watchlistSeeds: Array<{
    symbol: string;
    kind: string;
    units: number;
    cost: number;
    price: number;
    updated: string;
    source: string;
    url: string;
  }> = [
    { symbol: 'PAL', kind: 'DSE Stock', units: 0, cost: 0, price: 0, updated: '', source: 'DSE', url: '' },
    { symbol: 'DCB', kind: 'DSE Stock', units: 0, cost: 0, price: 0, updated: '', source: 'DSE', url: '' },
    { symbol: 'AFRIPRISE', kind: 'DSE Stock', units: 0, cost: 0, price: 0, updated: '', source: 'DSE', url: '' },
    { symbol: 'VODA', kind: 'DSE Stock', units: 0, cost: 0, price: 0, updated: '', source: 'DSE', url: '' },
    // UTT AMIS Liquid Fund (live scraped from uttamis.co.tz)
    {
      symbol: 'UTT AMIS Liquid Fund',
      kind: 'Fund',
      units: 0,
      cost: 0,
      price: 0,
      updated: '',
      source: 'UTT AMIS',
      url: 'https://uttamis.co.tz/uttamis2023/uttz/public/index.php',
    },
  ];

  const fixedSeeds = includeFixedStarter
    ? [
        {
          symbol: 'iAfrica Financials ETF',
          kind: 'ETF',
          units: 1000,
          cost: 100,
          price: 100,
          updated: 'Fixed until daily public updates',
          source: 'Fixed',
          url: '',
        },
        {
          symbol: 'iAfrica Mining & Energy ETF',
          kind: 'ETF',
          units: 1000,
          cost: 100,
          price: 100,
          updated: 'Fixed until daily public updates',
          source: 'Fixed',
          url: '',
        },
        {
          symbol: 'iAfrica Telco & Tech ETF',
          kind: 'ETF',
          units: 1000,
          cost: 100,
          price: 100,
          updated: 'Fixed until daily public updates',
          source: 'Fixed',
          url: '',
        },
        {
          symbol: 'Inuka Dozen Index Fund (Orbit)',
          kind: 'Fund',
          units: 1,
          cost: 20000,
          price: 25000,
          updated: 'Fixed until daily public updates',
          source: 'Fixed',
          url: '',
        },
      ]
    : [];

  for (const s of [...watchlistSeeds, ...fixedSeeds]) {
    if (!existsStmt.get(s.symbol)) {
      insertStmt.run(
        s.symbol,
        s.kind,
        s.units,
        s.cost,
        s.price,
        s.updated,
        today,
        s.source,
        s.url,
        '',
        '',
        'TZS'
      );
    }
  }
}

function getSettings(database: DatabaseSync) {
  const rows = database.prepare('SELECT k, v FROM settings').all() as Array<{ k: string; v: string }>;
  const map = new Map(rows.map((r) => [r.k, r.v]));
  let monthlyFixedExpenses: MonthlyFixedExpenseItem[] = getDefaultMonthlyFixedExpenses(false);
  const rawFixed = map.get('monthlyFixedExpenses');
  if (rawFixed) {
    try {
      const parsed = JSON.parse(rawFixed);
      if (Array.isArray(parsed)) {
        monthlyFixedExpenses = sanitizeMonthlyFixedExpenses(parsed);
      }
    } catch {
      // Fallback to template
    }
  }
  let subscription: SubscriptionRecord = { ...DEFAULT_SUBSCRIPTION };
  const rawSub = map.get('subscriptionJson');
  if (rawSub) {
    try {
      subscription = sanitizeSubscription(JSON.parse(rawSub));
    } catch {
      subscription = { ...DEFAULT_SUBSCRIPTION };
    }
  }

  const userEmail = (dbToEmailMap.get(database) || map.get('accountEmail') || '').trim().toLowerCase();
  if (userEmail) {
    const mdb = getMembersDb();
    const rawRow = mdb
      .prepare('SELECT * FROM members WHERE LOWER(email) = ?')
      .get(userEmail) as MemberSqlRow | undefined;
    if (rawRow) {
      const mRow = enforceMemberExpiryRow(mdb, rawRow);
      const isPro = mRow.membership_status === 'pro';
      const pClaimStatus: PaymentClaimStatus = isPro
        ? 'paid'
        : mRow.payment_status === 'pending_verification'
          ? 'pending_verification'
          : mRow.payment_status === 'expired'
            ? 'expired'
            : 'none';
      const syncedSub: SubscriptionRecord = isPro
        ? {
            plan: 'pro',
            paidAmountUsd: 5,
            paymentProvider:
              sanitizeProvider(mRow.payment_provider) === 'none'
                ? 'admin_manual'
                : sanitizeProvider(mRow.payment_provider),
            paymentRef: mRow.payment_ref || 'ADM-PRO',
            payerHint: mRow.payer_hint || mRow.claim_username || userEmail,
            paidAt: mRow.paid_at || new Date().toISOString(),
            expiresAt: mRow.expires_at,
            daysRemaining: computeDaysRemaining(mRow.expires_at),
            claimStatus: 'paid',
            claimUsername: mRow.claim_username,
            claimNote: mRow.claim_note,
            claimedAt: mRow.claimed_at,
          }
        : {
            ...DEFAULT_SUBSCRIPTION,
            paidAt: mRow.payment_status === 'expired' ? mRow.paid_at : '',
            expiresAt: mRow.payment_status === 'expired' ? mRow.expires_at : '',
            daysRemaining: mRow.payment_status === 'expired' ? 0 : null,
            claimStatus: pClaimStatus,
            claimUsername: mRow.claim_username,
            claimNote: mRow.claim_note,
            claimedAt: mRow.claimed_at,
          };

      const serialized = JSON.stringify(syncedSub);
      if (serialized !== rawSub || map.get('plan') !== syncedSub.plan) {
        const stmt = database.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)');
        stmt.run('plan', syncedSub.plan);
        stmt.run('subscriptionJson', serialized);
      }
      subscription = syncedSub;
    }
  }

  const plan: PlanTier = subscription.plan === 'pro' ? 'pro' : 'free';
  return {
    currency: 'TZS' as const,
    language: normalizeLanguage(map.get('language')),
    target: Number(map.get('target') || 100000000) || 100000000,
    autoRefreshOnOpen: (map.get('autoRefreshOnOpen') ?? 'true') !== 'false',
    onboardingCompleted: (map.get('onboardingCompleted') ?? 'false') === 'true',
    khumsEnabled: (map.get('khumsEnabled') ?? 'true') !== 'false',
    monthlyFixedExpenses,
    plan,
    subscription,
    isAdmin: isAdminEmail(userEmail),
  };
}

function requireProPlan(
  database: DatabaseSync,
  res: ExpressResponse,
  featureLabel: string
): boolean {
  const current = getSettings(database);
  if (current.plan === 'pro') return true;
  res.status(402).json({
    error: `${featureLabel} is a FinanceDesk Pro feature ($5). Upgrade to unlock AI Imports, Khums & TRA Taxes, and Report Generation.`,
    code: 'PRO_REQUIRED',
  });
  return false;
}

function getSnapshot(database: DatabaseSync) {
  const balRows = database
    .prepare('SELECT section, type, amount FROM balance')
    .all() as Array<{ section: string; type: string; amount: number }>;

  let ca = 0;
  let cl = 0;
  let la = 0;
  let ll = 0;
  let bank = 0;
  let hand = 0;

  for (const r of balRows) {
    const val = Number(r.amount || 0);
    if (r.section === 'current_asset') ca += val;
    else if (r.section === 'current_liability') cl += val;
    else if (r.section === 'longterm_asset') la += val;
    else if (r.section === 'longterm_liability') ll += val;

    if (r.type === 'Cash in bank') bank += val;
    else if (r.type === 'Cash in hand') hand += val;
  }

  const holdRows = database
    .prepare('SELECT kind, units, cost, price FROM holdings WHERE units > 0')
    .all() as Array<{
    kind: string;
    units: number;
    cost: number;
    price: number;
  }>;

  let port = 0;
  let stocks = 0;
  let bf = 0;

  for (const h of holdRows) {
    const px = h.price > 0 ? h.price : h.cost;
    const val = h.units * px;
    port += val;
    if (h.kind === 'DSE Stock' || h.kind === 'Stock' || h.kind === 'ETF') {
      stocks += val;
    } else if (h.kind === 'Bond' || h.kind === 'Fund') {
      bf += val;
    }
  }

  la += port;

  return {
    ca,
    cl,
    la,
    ll,
    port,
    wc: ca - cl,
    nw: ca + la - cl - ll,
    bank,
    hand,
    stocks,
    bf,
  };
}

function getRunway(database: DatabaseSync) {
  const cashRow = database
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS cash FROM balance WHERE section = 'current_asset' AND type IN ('Cash in bank', 'Cash in hand')"
    )
    .get() as { cash: number };

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceIso = since.toISOString().slice(0, 10);

  const outRow = database
    .prepare(
      "SELECT COALESCE(SUM(ABS(amount)), 0) AS totalOut FROM transactions WHERE amount < 0 AND activity = 'operating' AND date >= ?"
    )
    .get(sinceIso) as { totalOut: number };

  const burn = Number(outRow.totalOut || 0) / 3;
  const cash = Number(cashRow.cash || 0);

  return {
    burn,
    months: burn > 0 ? cash / burn : null,
  };
}

function getFullState(database: DatabaseSync) {
  const balance = database
    .prepare('SELECT id, section, name, amount, date, type FROM balance ORDER BY section, name, id DESC')
    .all();

  const transactions = database
    .prepare(
      'SELECT id, date, activity, category, description, amount, receipt_id AS receiptId, receipt_name AS receiptName, receipt_mime AS receiptMime FROM transactions ORDER BY date DESC, id DESC'
    )
    .all();

  const holdings = database
    .prepare(
      'SELECT id, symbol, kind, units, cost, price, updated, date, source, url, selector, regex FROM holdings ORDER BY symbol ASC, id ASC'
    )
    .all();

  let khumsTaxConfig: Record<string, unknown> | undefined;
  const rawCalcRow = database
    .prepare("SELECT v FROM settings WHERE k = 'khumsTaxConfig'")
    .get() as { v: string } | undefined;
  if (rawCalcRow?.v) {
    try {
      const parsed = JSON.parse(rawCalcRow.v) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        khumsTaxConfig = parsed as Record<string, unknown>;
      }
    } catch {
      khumsTaxConfig = undefined;
    }
  }

  return {
    settings: getSettings(database),
    balance,
    transactions,
    holdings,
    indicators: database.prepare('SELECT * FROM indicators ORDER BY name ASC, id ASC').all(),
    snapshot: getSnapshot(database),
    runway: getRunway(database),
    khumsTaxConfig,
  };
}

// ----------------------------------------------------------------------------- SSRF & Scraping
function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h === 'metadata.google.internal'
  ) {
    return true;
  }

  if (net.isIPv4(h)) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  }

  if (net.isIPv6(h)) {
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
      return true;
    }
  }

  return false;
}

function validateExternalUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS URLs are permitted');
  }
  if (isPrivateOrLocalHost(parsed.hostname)) {
    throw new Error('Private or local network URLs are not permitted');
  }
  return parsed;
}

function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/(\d),\s+(?=\d)/g, '$1').replace(/,/g, '');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const val = Number(match[0]);
  return Number.isFinite(val) ? val : null;
}

async function fetchWithTimeout(url: string, timeoutMs = 14000): Promise<Response> {
  return fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function extractSpacedText(html: string, selector = 'body'): string {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const root = selector ? $(selector).first() : $('body');
  const tokens: string[] = [];
  root
    .find('*')
    .addBack()
    .contents()
    .each((_, el) => {
      if (el.type === 'text') {
        const t = $(el).text().replace(/\s+/g, ' ').trim();
        if (t) tokens.push(t);
      }
    });
  return tokens.join(' ').replace(/(\d),\s+(?=\d)/g, '$1,');
}

type BoardMap = Record<string, { price: number; change?: number; origin: string }>;

const DSE_BOARD_CACHE_TTL_MS = 2 * 60 * 1000;
let dseBoardCache: { board: BoardMap; ts: number } | null = null;

function parseHisazanguStocksHtml(html: string, originLabel = 'Hisazangu DSE Feed'): BoardMap {
  const board: BoardMap = {};
  const $ = cheerio.load(html);

  $('table tr').each((_, tr) => {
    const tds = $(tr)
      .find('td')
      .map((__, td) => $(td).text().replace(/\s+/g, ' ').trim())
      .get();
    if (tds.length >= 4) {
      const sym = tds[0].toUpperCase();
      if (!/^[A-Z][A-Z0-9 .&-]{0,24}$/.test(sym) || sym === 'STOCK') return;
      const priceMatch = tds[2].match(/^([\d,]+(?:\.\d+)?)/);
      if (!priceMatch) return;
      const price = parseNumber(priceMatch[1]);
      if (price !== null && price > 0 && !board[sym]) {
        const changeVal = parseNumber(tds[3]);
        board[sym] = {
          price,
          change: changeVal !== null ? changeVal : undefined,
          origin: originLabel,
        };
      }
    }
  });

  return board;
}

function applyDseBoardAliases(board: BoardMap): void {
  if (board['TCCL'] && !board['SIMBA']) {
    board['SIMBA'] = { ...board['TCCL'] };
  } else if (board['SIMBA'] && !board['TCCL']) {
    board['TCCL'] = { ...board['SIMBA'] };
  }
  if (board['ZAN TIMIZA ETF'] && !board['ZAN-TIMIZA-ETF']) {
    board['ZAN-TIMIZA-ETF'] = { ...board['ZAN TIMIZA ETF'] };
  } else if (board['ZAN-TIMIZA-ETF'] && !board['ZAN TIMIZA ETF']) {
    board['ZAN TIMIZA ETF'] = { ...board['ZAN-TIMIZA-ETF'] };
  }
  if (board['IEACLC-ETF'] && !board['IEACLC']) {
    board['IEACLC'] = { ...board['IEACLC-ETF'] };
  }
}

function lookupDseBoardHit(symbol: string, board: BoardMap) {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return undefined;
  return (
    board[clean] ||
    board[clean.replace(/\s+/g, '-')] ||
    board[clean.replace(/-/g, ' ')]
  );
}

function parseDseHtmlMultiStrategy(html: string, originLabel: string): BoardMap {
  const board: BoardMap = {};
  const $ = cheerio.load(html);

  $('table tr').each((_, tr) => {
    const cells = $(tr)
      .find('th, td')
      .map((__, td) => $(td).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
    if (cells.length >= 2) {
      const sym = cells[0].toUpperCase();
      if (/^[A-Z][A-Z0-9 .&-]{1,22}$/.test(sym)) {
        const numericCells = cells
          .slice(1)
          .filter((c) => /^[\d,]+(?:\.\d+)?$/.test(c))
          .map((c) => parseNumber(c))
          .filter((n): n is number => n !== null && n > 0);
        if (numericCells.length > 0) {
          board[sym] = { price: numericCells[numericCells.length - 1], origin: originLabel };
        }
      }
    }
  });

  const text = extractSpacedText(html);
  const entryRegex =
    /\b([A-Z][A-Z0-9&-]{1,18}(?:\s+[A-Z0-9&-]{1,12}){0,2})\s+([\d,]+(?:\.\d+)?)\s+([+-]?[\d.]+\s*%)/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(text)) !== null) {
    const sym = match[1].trim().toUpperCase();
    const price = parseNumber(match[2]);
    if (sym && price !== null && price > 0 && !board[sym]) {
      board[sym] = { price, origin: originLabel };
    }
  }

  return board;
}

async function fetchDseBoard(forceRefresh = false): Promise<{ board: BoardMap; errors: string[] }> {
  if (!forceRefresh && dseBoardCache && Date.now() - dseBoardCache.ts < DSE_BOARD_CACHE_TTL_MS) {
    return { board: dseBoardCache.board, errors: [] };
  }

  const board: BoardMap = {};
  const sourceErrors: string[] = [];

  const [jsonRes, allEqRes, homeRes, hisaRes] = await Promise.allSettled([
    fetchWithTimeout('https://dse.co.tz/api/get/live/market/prices', 6500),
    fetchWithTimeout('https://dse.co.tz/en/all-equities', 6500),
    fetchWithTimeout('https://dse.co.tz/en', 6500),
    fetchWithTimeout('https://hisazangu.com/stocks', 8000),
  ]);

  if (jsonRes.status === 'fulfilled') {
    if (jsonRes.value.ok) {
      try {
        const payload = (await jsonRes.value.json()) as {
          success?: boolean;
          data?: Array<{ company?: string; price?: number | string; change?: number | string }>;
        };
        if (Array.isArray(payload.data)) {
          for (const item of payload.data) {
            const sym = String(item.company || '').trim().toUpperCase();
            const price = Number(item.price);
            if (sym && Number.isFinite(price) && price > 0) {
              board[sym] = {
                price,
                change: Number.isFinite(Number(item.change)) ? Number(item.change) : undefined,
                origin: 'DSE Live API',
              };
            }
          }
        }
      } catch (e) {
        sourceErrors.push(`DSE Live API parse error: ${(e as Error).message}`);
      }
    } else {
      sourceErrors.push(`DSE Live API HTTP ${jsonRes.value.status}`);
    }
  } else {
    sourceErrors.push(`dse.co.tz unreachable (${(jsonRes.reason as Error)?.message || 'timeout'})`);
  }

  for (const [label, res] of [
    ['DSE Equities Board', allEqRes],
    ['DSE Home Board', homeRes],
  ] as const) {
    if (res.status === 'fulfilled') {
      if (res.value.ok) {
        try {
          const html = await res.value.text();
          const parsed = parseDseHtmlMultiStrategy(html, label);
          for (const [k, v] of Object.entries(parsed)) {
            if (!board[k]) board[k] = v;
          }
        } catch (e) {
          sourceErrors.push(`${label}: ${(e as Error).message}`);
        }
      } else {
        sourceErrors.push(`${label}: HTTP ${res.value.status}`);
      }
    } else {
      sourceErrors.push(`${label}: ${(res.reason as Error)?.message || 'timeout'}`);
    }
  }

  // Fallback & ETF completion via Hisazangu live DSE mirror (covers equities + IEACLC-ETF, VERTEX-ETF, ZAN TIMIZA ETF)
  if (hisaRes.status === 'fulfilled') {
    if (hisaRes.value.ok) {
      try {
        const html = await hisaRes.value.text();
        const parsed = parseHisazanguStocksHtml(html, 'DSE via Hisazangu');
        for (const [k, v] of Object.entries(parsed)) {
          if (!board[k]) board[k] = v;
        }
      } catch (e) {
        sourceErrors.push(`Hisazangu DSE Feed: ${(e as Error).message}`);
      }
    } else {
      sourceErrors.push(`Hisazangu DSE Feed: HTTP ${hisaRes.value.status}`);
    }
  } else {
    sourceErrors.push(`Hisazangu DSE Feed: ${(hisaRes.reason as Error)?.message || 'timeout'}`);
  }

  applyDseBoardAliases(board);

  if (Object.keys(board).length > 0) {
    dseBoardCache = { board, ts: Date.now() };
    return { board, errors: [] };
  }

  return { board, errors: sourceErrors };
}

type UttMap = Record<string, { nav: number; sale: number; repurchase: number; asOf: string }>;

async function fetchUttAmisNavs(): Promise<{ funds: UttMap; asOf: string; error?: string }> {
  const funds: UttMap = {};
  let asOf = '';

  const targets = [
    'https://uttamis.co.tz/uttamis2023/uttz/public/index.php',
    'https://uttamis.co.tz/fund-performance',
    'https://uttamis.co.tz/',
  ];

  const fundNames = [
    'Umoja Fund',
    'Wekeza Maisha Fund',
    'Watoto Fund',
    'Jikimu Fund',
    'Liquid Fund',
    'Bond Fund',
  ];

  for (const targetUrl of targets) {
    try {
      const res = await fetchWithTimeout(targetUrl);
      if (!res.ok) continue;
      const html = await res.text();
      const cleanText = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(\d),\s+(?=\d)/g, '$1,');

      for (const fundName of fundNames) {
        const escaped = fundName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rxPrimary = new RegExp(
          `${escaped}\\s+Date:\\s*(.+?)\\s+Net Asset Value \\(Tsh\\)\\s+Outstanding Number of Units \\(Tsh\\)\\s+Net Asset Value Per Unit \\(Tsh\\)\\s+Sale Price Per Unit \\(Tsh\\)\\s+Repurchase Price Per Unit \\(Tsh\\)\\s+([\\d,]+\\.\\d+)\\s+([\\d,]+\\.\\d+)\\s+([\\d,]+\\.\\d+)\\s+([\\d,]+\\.\\d+)\\s+([\\d,]+\\.\\d+)`,
          'i'
        );
        const m = cleanText.match(rxPrimary);
        if (m) {
          const dateStr = m[1].trim();
          const nav = parseNumber(m[4]);
          const sale = parseNumber(m[5]);
          const repurchase = parseNumber(m[6]);
          if (nav !== null && nav > 0) {
            asOf = asOf || dateStr;
            funds[fundName.toUpperCase()] = {
              nav,
              sale: sale ?? nav,
              repurchase: repurchase ?? nav,
              asOf: dateStr,
            };
            continue;
          }
        }

        const rxFallback = new RegExp(
          `${escaped}[^\\d]{0,160}([\\d,]+\\.\\d{2,4})\\s+([\\d,]+\\.\\d{2,4})\\s+([\\d,]+\\.\\d{2,4})\\s+([\\d,]+\\.\\d{2,4})`,
          'i'
        );
        const mf = cleanText.match(rxFallback);
        if (mf) {
          const nav = parseNumber(mf[3]);
          const sale = parseNumber(mf[4]);
          if (nav !== null && nav > 0 && nav < 100000) {
            funds[fundName.toUpperCase()] = {
              nav,
              sale: sale ?? nav,
              repurchase: nav,
              asOf: asOf || todayIso(),
            };
          }
        }
      }

      if (Object.keys(funds).length > 0) {
        return { funds, asOf };
      }
    } catch {
      // Try next URL
    }
  }

  return {
    funds,
    asOf,
    error: 'Could not locate UTT AMIS NAV table on uttamis.co.tz',
  };
}

function matchUttFund(symbol: string, funds: UttMap) {
  const s = symbol.toLowerCase();
  if (s.includes('liquid')) return funds['LIQUID FUND'];
  if (s.includes('umoja')) return funds['UMOJA FUND'];
  if (s.includes('wekeza')) return funds['WEKEZA MAISHA FUND'];
  if (s.includes('watoto')) return funds['WATOTO FUND'];
  if (s.includes('jikimu')) return funds['JIKIMU FUND'];
  if (s.includes('bond')) return funds['BOND FUND'];
  return undefined;
}

const DSE_INVESTING_SLUGS: Array<[RegExp, string]> = [
  [/\bcrdb\b/i, 'CRDB'],
  [/\bnmb\b/i, 'NMB'],
  [/\bvodacom\b|\bvoda\b/i, 'VODA'],
  [/tanzania-?breweries|\btbl\b/i, 'TBL'],
  [/portland-?cement|twiga|\btpcc\b/i, 'TPCC'],
  [/tanga-?cement|\bsimba\b/i, 'SIMBA'],
  [/swissport|\bswis\b/i, 'SWIS'],
  [/precision-?air|\bpal\b/i, 'PAL'],
  [/dar-?es-?salaam-?stock|\bdse\b/i, 'DSE'],
  [/east-?african-?breweries|\beabl\b/i, 'EABL'],
  [/kenya-?airways|\bka\b/i, 'KA'],
  [/\bkcb\b/i, 'KCB'],
  [/jubilee|\bjhl\b/i, 'JHL'],
  [/nation-?media|\bnmg\b/i, 'NMG'],
  [/\bdcb\b/i, 'DCB'],
  [/maendeleo|\bmbp\b/i, 'MBP'],
  [/mwalimu|\bmcb\b/i, 'MCB'],
  [/mucoba/i, 'MUCOBA'],
  [/yetu/i, 'YETU'],
  [/tanzania-?cigarette|\btcc\b/i, 'TCC'],
  [/\btol\b/i, 'TOL'],
  [/tatepa|\bttp\b/i, 'TTP'],
  [/afriprise/i, 'AFRIPRISE'],
  [/nicol|\bnico\b/i, 'NICO'],
  [/mkombozi|\bmkcb\b/i, 'MKCB'],
  [/ieaclc|itrust.*etf/i, 'IEACLC-ETF'],
  [/vertex/i, 'VERTEX-ETF'],
  [/zan.*timiza/i, 'ZAN TIMIZA ETF'],
];

function extractInvestingSlug(rawUrl: string): string {
  try {
    const u = new URL(rawUrl.trim());
    const segs = u.pathname.split('/').filter(Boolean);
    return (segs[segs.length - 1] || '').replace(/-historical-data$/i, '');
  } catch {
    return '';
  }
}

function resolveDseTickerFromHints(symbol: string, rawUrl: string, board: BoardMap): string | null {
  const cleanSym = symbol.trim().toUpperCase();
  if (cleanSym && board[cleanSym]) return cleanSym;

  const slug = extractInvestingSlug(rawUrl);
  const combined = `${symbol} ${slug}`;
  for (const [rx, ticker] of DSE_INVESTING_SLUGS) {
    if (rx.test(combined) && board[ticker]) {
      return ticker;
    }
  }
  return null;
}

function normalizeCurrencySubunit(
  rawPrice: number,
  rawCurrency?: string
): { price: number; currency: string } {
  const ccyRaw = (rawCurrency || 'USD').trim();
  if (ccyRaw === 'GBp' || ccyRaw === 'GBX') {
    return { price: rawPrice / 100, currency: 'GBP' };
  }
  if (ccyRaw === 'ZAc' || ccyRaw === 'ZAC') {
    return { price: rawPrice / 100, currency: 'ZAR' };
  }
  if (ccyRaw === 'ILA') {
    return { price: rawPrice / 100, currency: 'ILS' };
  }
  if (ccyRaw === 'USX') {
    return { price: rawPrice / 100, currency: 'USD' };
  }
  return { price: rawPrice, currency: ccyRaw.toUpperCase() || 'USD' };
}

function extractTickerFromUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase();
    const segs = u.pathname.split('/').filter(Boolean);
    if (host.includes('finance.yahoo.com')) {
      const idx = segs.findIndex((s) => s.toLowerCase() === 'quote');
      if (idx >= 0 && segs[idx + 1]) {
        return decodeURIComponent(segs[idx + 1]).trim();
      }
    }
    if (host.includes('stockanalysis.com')) {
      if (segs[0] === 'quote' && segs[1] && segs[2]) {
        const ex = segs[1].toLowerCase();
        const tkr = segs[2].toUpperCase();
        if (ex === 'lon') return `${tkr}.L`;
        if (ex === 'tsx') return `${tkr}.TO`;
        if (ex === 'asx') return `${tkr}.AX`;
        return tkr;
      }
      if ((segs[0] === 'stocks' || segs[0] === 'etf') && segs[1]) {
        return segs[1].toUpperCase();
      }
    }
    if (host.includes('investing.com')) {
      return (segs[segs.length - 1] || '').replace(/-historical-data$/i, '');
    }
  } catch {
    return '';
  }
  return '';
}

const FX_MEMORY_TTL_MS = 15 * 60 * 1000;
const fxMemoryCache = new Map<string, { rate: number; ts: number }>();

function cacheFxRate(ccy: string, rate: number, fxCache: Map<string, number>): void {
  if (!Number.isFinite(rate) || rate <= 0) return;
  fxCache.set(ccy, rate);
  fxMemoryCache.set(ccy, { rate, ts: Date.now() });
}

async function fetchUsdRatesFromFallbackApis(): Promise<Record<string, number> | null> {
  // 1. ExchangeRate-API Open endpoint (no key, all ISO currencies including TZS)
  try {
    const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', 7000);
    if (res.ok) {
      const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
      if (data.rates && Number.isFinite(data.rates.TZS) && data.rates.TZS > 0) {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(data.rates)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
            out[k.toUpperCase()] = v;
          }
        }
        return out;
      }
    }
  } catch {
    // Try next FX provider
  }

  // 2. jsDelivr CDN currency-api (globally CDN-cached, resilient to server rate-limits)
  try {
    const res = await fetchWithTimeout(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      7000
    );
    if (res.ok) {
      const data = (await res.json()) as { usd?: Record<string, number> };
      if (data.usd && Number.isFinite(data.usd.tzs) && data.usd.tzs > 0) {
        const out: Record<string, number> = { USD: 1 };
        for (const [k, v] of Object.entries(data.usd)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
            out[k.toUpperCase()] = v;
          }
        }
        return out;
      }
    }
  } catch {
    // Try next FX provider
  }

  // 3. ExchangeRate-API v4 fallback
  try {
    const res = await fetchWithTimeout('https://api.exchangerate-api.com/v4/latest/USD', 7000);
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      if (data.rates && Number.isFinite(data.rates.TZS) && data.rates.TZS > 0) {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(data.rates)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
            out[k.toUpperCase()] = v;
          }
        }
        return out;
      }
    }
  } catch {
    // Exhausted fallbacks
  }

  return null;
}

async function fetchFxToTzs(fromCurrency: string, fxCache: Map<string, number>): Promise<number | null> {
  const ccy = fromCurrency.trim().toUpperCase();
  if (!ccy || ccy === 'TZS') return 1;
  if (fxCache.has(ccy)) return fxCache.get(ccy)!;

  const mem = fxMemoryCache.get(ccy);
  if (mem && Date.now() - mem.ts < FX_MEMORY_TTL_MS && mem.rate > 0) {
    fxCache.set(ccy, mem.rate);
    return mem.rate;
  }

  // 1. Try Yahoo Finance direct pair (e.g. USDTZS=X, GBPTZS=X)
  const tryDirect = await fetchYahooChartRaw(`${ccy}TZS=X`);
  if (tryDirect.price !== null && tryDirect.price > 0) {
    cacheFxRate(ccy, tryDirect.price, fxCache);
    return tryDirect.price;
  }

  // 2. Try Yahoo Finance cross via USD
  let usdToTzs: number | null = fxCache.get('USD') ?? null;
  if (!usdToTzs) {
    const usdMem = fxMemoryCache.get('USD');
    if (usdMem && Date.now() - usdMem.ts < FX_MEMORY_TTL_MS && usdMem.rate > 0) {
      usdToTzs = usdMem.rate;
      fxCache.set('USD', usdToTzs);
    }
  }
  if (!usdToTzs) {
    const yhUsd = await fetchYahooChartRaw('USDTZS=X');
    if (yhUsd.price !== null && yhUsd.price > 0) {
      usdToTzs = yhUsd.price;
      cacheFxRate('USD', usdToTzs, fxCache);
    }
  }

  if (usdToTzs && usdToTzs > 0) {
    if (ccy === 'USD') return usdToTzs;
    const usdToCcy = await fetchYahooChartRaw(`USD${ccy}=X`);
    if (usdToCcy.price && usdToCcy.price > 0) {
      const rate = usdToTzs / usdToCcy.price;
      cacheFxRate(ccy, rate, fxCache);
      return rate;
    }
  }

  // 3. Resilient multi-provider FX fallback (open.er-api -> jsDelivr currency-api -> exchangerate-api)
  const usdRates = await fetchUsdRatesFromFallbackApis();
  if (usdRates && usdRates.TZS > 0) {
    const tzsPerUsd = usdRates.TZS;
    cacheFxRate('USD', tzsPerUsd, fxCache);
    for (const [k, perUsd] of Object.entries(usdRates)) {
      if (k !== 'TZS' && perUsd > 0) {
        cacheFxRate(k, tzsPerUsd / perUsd, fxCache);
      }
    }
    const resolved = fxCache.get(ccy);
    if (resolved && resolved > 0) return resolved;
  }

  return null;
}

async function fetchYahooChartRaw(
  symbol: string
): Promise<{ price: number | null; currency?: string; error?: string }> {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastErr = 'Yahoo Finance unavailable';
  for (const host of hosts) {
    try {
      const res = await fetchWithTimeout(
        `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`,
        9000
      );
      if (!res.ok) {
        lastErr = `Yahoo Finance HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: { regularMarketPrice?: number; chartPreviousClose?: number; currency?: string };
            indicators?: { quote?: Array<{ close?: Array<number | null> }> };
          }>;
        };
      };
      const result = data.chart?.result?.[0];
      const currency = result?.meta?.currency;
      const reg = result?.meta?.regularMarketPrice;
      if (typeof reg === 'number' && reg > 0) return { price: reg, currency };
      const closes = (result?.indicators?.quote?.[0]?.close || []).filter(
        (v): v is number => typeof v === 'number' && v > 0
      );
      if (closes.length > 0) return { price: closes[closes.length - 1], currency };
      const prevClose = result?.meta?.chartPreviousClose;
      if (typeof prevClose === 'number' && prevClose > 0) return { price: prevClose, currency };
      lastErr = 'No price returned by Yahoo Finance';
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { price: null, error: lastErr };
}

async function fetchStockAnalysisQuoteRaw(
  symbol: string,
  explicitUrl = ''
): Promise<{ price: number | null; currency: string; resolvedSymbol: string; error?: string }> {
  const cleanSym = symbol.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
  const urls: string[] = [];

  if (explicitUrl && /stockanalysis\.com/i.test(explicitUrl)) {
    urls.push(explicitUrl.trim());
  }
  if (cleanSym) {
    if (cleanSym.endsWith('.l')) {
      const base = cleanSym.slice(0, -2);
      urls.push(`https://stockanalysis.com/quote/lon/${encodeURIComponent(base)}/`);
    } else if (cleanSym.endsWith('.to')) {
      const base = cleanSym.slice(0, -3);
      urls.push(`https://stockanalysis.com/quote/tsx/${encodeURIComponent(base)}/`);
    } else {
      const base = cleanSym.replace(/\.[a-z]+$/, '');
      urls.push(
        `https://stockanalysis.com/stocks/${encodeURIComponent(base)}/`,
        `https://stockanalysis.com/etf/${encodeURIComponent(base)}/`
      );
    }
  }

  let lastErr = 'Ticker not found on StockAnalysis';
  for (const candidateUrl of urls) {
    try {
      validateExternalUrl(candidateUrl);
      const res = await fetchWithTimeout(candidateUrl, 8000);
      if (!res.ok) {
        lastErr = `StockAnalysis HTTP ${res.status}`;
        continue;
      }
      const html = await res.text();
      const $ = cheerio.load(html);
      const domText = $('.text-4xl.font-bold').first().text().trim();
      const domPx = parseNumber(domText);
      const svelteMatch =
        html.match(/\bp(?:rice)?\s*:\s*(\d+(?:\.\d+)?)/i) ||
        html.match(/"price"\s*:\s*([\d.]+)/);
      const ccyMatch = html.match(/["']?currency["']?\s*:\s*["']([A-Za-z]{3})["']/i);
      const rawPx = domPx !== null && domPx > 0 ? domPx : svelteMatch ? parseNumber(svelteMatch[1]) : null;
      if (rawPx !== null && rawPx > 0) {
        return {
          price: rawPx,
          currency: (
            ccyMatch?.[1] ||
            (domText.includes('£') ? 'GBP' : domText.includes('€') ? 'EUR' : 'USD')
          ).toUpperCase(),
          resolvedSymbol: symbol.trim().toUpperCase() || extractTickerFromUrl(candidateUrl),
        };
      }
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  return { price: null, currency: 'USD', resolvedSymbol: symbol.trim(), error: lastErr };
}

async function fetchStockAnalysisPriceInTzs(
  symbol: string,
  fxCache: Map<string, number>,
  explicitUrl = ''
): Promise<{
  price: number | null;
  resolvedSymbol?: string;
  nativePrice?: number;
  nativeCurrency?: string;
  fxRate?: number;
  error?: string;
}> {
  const hint = extractTickerFromUrl(explicitUrl);
  const sym = symbol.trim() || hint;
  const raw = await fetchStockAnalysisQuoteRaw(sym, explicitUrl);
  if (raw.price === null || raw.price <= 0) {
    return { price: null, error: raw.error };
  }
  const normalized = normalizeCurrencySubunit(raw.price, raw.currency);
  const fx = await fetchFxToTzs(normalized.currency, fxCache);
  if (fx === null || fx <= 0) {
    return { price: null, error: `Could not convert ${normalized.currency} to TZS` };
  }
  return {
    price: Math.round(normalized.price * fx * 100) / 100,
    resolvedSymbol: raw.resolvedSymbol,
    nativePrice: normalized.price,
    nativeCurrency: normalized.currency,
    fxRate: fx,
  };
}

async function fetchYahooPriceInTzs(
  symbolOrQuery: string,
  fxCache: Map<string, number>,
  urlOrSlugHint = ''
): Promise<{
  price: number | null;
  resolvedSymbol?: string;
  nativePrice?: number;
  nativeCurrency?: string;
  fxRate?: number;
  sourceLabel?: string;
  error?: string;
}> {
  const urlTicker = extractTickerFromUrl(urlOrSlugHint);
  const directSym = symbolOrQuery.trim();
  const candidates: string[] = [];

  if (urlTicker && !urlTicker.includes(' ') && !urlTicker.includes('-')) {
    candidates.push(urlTicker);
  }
  if (directSym && !directSym.includes(' ')) {
    if (!candidates.includes(directSym.toUpperCase())) candidates.push(directSym.toUpperCase());
    if (!candidates.includes(directSym)) candidates.push(directSym);
  }

  let lastErr = 'No matching Yahoo Finance (yfinance) ticker found';
  const tryCandidates = async (list: string[]) => {
    for (const cand of list) {
      const raw = await fetchYahooChartRaw(cand);
      if (raw.price !== null && raw.price > 0) {
        const norm = normalizeCurrencySubunit(raw.price, raw.currency);
        if (norm.currency === 'TZS') {
          return {
            price: norm.price,
            resolvedSymbol: cand,
            nativePrice: norm.price,
            nativeCurrency: 'TZS',
            fxRate: 1,
            sourceLabel: `Yahoo Finance (${cand})`,
          };
        }
        const fx = await fetchFxToTzs(norm.currency, fxCache);
        if (fx !== null && fx > 0) {
          return {
            price: Math.round(norm.price * fx * 100) / 100,
            resolvedSymbol: cand,
            nativePrice: norm.price,
            nativeCurrency: norm.currency,
            fxRate: fx,
            sourceLabel: `Yahoo Finance (${cand}, ${norm.currency}->TZS)`,
          };
        }
        lastErr = `Could not convert ${norm.currency} to TZS`;
      } else if (raw.error) {
        lastErr = raw.error;
      }
    }
    return null;
  };

  // Try direct symbol / URL ticker first without hitting Yahoo search unnecessarily
  if (candidates.length > 0) {
    const directHit = await tryCandidates(candidates.slice(0, 3));
    if (directHit) return directHit;
  }

  // Only invoke Yahoo search if direct symbol lookup failed or input had spaces/company name
  const searched: string[] = [];
  const queries = [
    directSym,
    urlTicker.replace(/-/g, ' '),
    urlOrSlugHint && !urlOrSlugHint.startsWith('http') ? urlOrSlugHint.replace(/-/g, ' ') : '',
  ].filter((q) => q && q.trim().length >= 2);

  for (const q of queries) {
    try {
      const sRes = await fetchWithTimeout(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=6&newsCount=0`,
        7000
      );
      if (sRes.ok) {
        const sData = (await sRes.json()) as {
          quotes?: Array<{ symbol?: string; quoteType?: string }>;
        };
        const sorted = [...(sData.quotes || [])].sort((a, b) => {
          const rank = (t?: string) =>
            t === 'EQUITY' || t === 'ETF' ? 0 : t === 'MUTUALFUND' || t === 'CRYPTOCURRENCY' ? 1 : 2;
          return rank(a.quoteType) - rank(b.quoteType);
        });
        for (const quote of sorted) {
          if (quote.symbol && !candidates.includes(quote.symbol) && !searched.includes(quote.symbol)) {
            searched.push(quote.symbol);
          }
        }
      }
    } catch {
      // Ignore search failures and proceed to StockAnalysis fallback
    }
  }

  if (searched.length > 0) {
    const searchHit = await tryCandidates(searched.slice(0, 4));
    if (searchHit) return searchHit;
  }

  // Fallback to StockAnalysis scraper if Yahoo didn't resolve
  const saFallback = await fetchStockAnalysisPriceInTzs(
    candidates[0] || searched[0] || directSym || urlTicker,
    fxCache,
    urlOrSlugHint
  );
  if (saFallback.price !== null) {
    return {
      ...saFallback,
      sourceLabel: `StockAnalysis (${saFallback.resolvedSymbol || directSym})`,
    };
  }

  return { price: null, error: lastErr };
}

async function resolveInvestingComPrice(
  symbol: string,
  rawUrl: string,
  dseBoard: BoardMap,
  uttFunds: UttMap,
  fxCache: Map<string, number>
): Promise<{ price: number | null; sourceLabel?: string; error?: string }> {
  const dseTicker = resolveDseTickerFromHints(symbol, rawUrl, dseBoard);
  if (dseTicker && dseBoard[dseTicker]) {
    return {
      price: dseBoard[dseTicker].price,
      sourceLabel: `${dseBoard[dseTicker].origin} (${dseTicker})`,
    };
  }

  const slug = extractInvestingSlug(rawUrl);
  const uttHit = matchUttFund(`${symbol} ${slug}`, uttFunds);
  if (uttHit) {
    return { price: uttHit.nav, sourceLabel: `UTT AMIS (${uttHit.asOf || 'NAV'})` };
  }

  // Resolve directly through Yahoo Finance (yfinance v8) + StockAnalysis fallback (Investing.com blocks automated servers)
  const yh = await fetchYahooPriceInTzs(symbol, fxCache, slug || rawUrl);
  if (yh.price !== null) {
    return {
      price: yh.price,
      sourceLabel: yh.sourceLabel || `Yahoo Finance (${yh.resolvedSymbol || symbol})`,
    };
  }

  return {
    price: null,
    error: yh.error || 'Could not resolve international quote from Yahoo Finance or StockAnalysis',
  };
}

async function fetchYahooPrice(symbol: string): Promise<{ price: number | null; error?: string }> {
  const fxCache = new Map<string, number>();
  return fetchYahooPriceInTzs(symbol, fxCache);
}

function normalizeHoldingSource(rawSource: unknown, rawUrl: string): string {
  const src = typeof rawSource === 'string' && VALID_SOURCES.has(rawSource) ? rawSource : 'DSE';
  const u = rawUrl.trim().toLowerCase();
  if ((src === 'Web' || src === 'Investing.com') && u) {
    if (u.includes('stockanalysis.com')) return 'StockAnalysis';
    if (u.includes('investing.com') || u.includes('finance.yahoo.com')) return 'Yahoo';
  }
  return src;
}

async function scrapeGenericPage(
  rawUrl: string,
  selector = '',
  regex = '',
  symbolHint = ''
): Promise<{ raw: string | null; numeric: number | null; sourceLabel?: string; error?: string }> {
  const parsed = validateExternalUrl(rawUrl);
  const host = parsed.hostname.toLowerCase();

  // Never scrape Investing.com directly (blocks servers with 403 Cloudflare challenge)
  if (host === 'investing.com' || host.endsWith('.investing.com')) {
    const fxCache = new Map<string, number>();
    const [dse, utt] = await Promise.all([fetchDseBoard(), fetchUttAmisNavs()]);
    const inv = await resolveInvestingComPrice(symbolHint, rawUrl, dse.board, utt.funds, fxCache);
    if (inv.price !== null && inv.price > 0) {
      return {
        raw: `TZS ${inv.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        numeric: inv.price,
        sourceLabel: inv.sourceLabel || 'Yahoo Finance',
      };
    }
    return { raw: null, numeric: null, error: inv.error || 'Could not resolve Investing.com quote' };
  }

  if (host === 'finance.yahoo.com' || host.endsWith('.finance.yahoo.com')) {
    const fxCache = new Map<string, number>();
    const yh = await fetchYahooPriceInTzs(symbolHint, fxCache, rawUrl);
    if (yh.price !== null && yh.price > 0) {
      return {
        raw: `TZS ${yh.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        numeric: yh.price,
        sourceLabel: yh.sourceLabel || 'Yahoo Finance',
      };
    }
    return { raw: null, numeric: null, error: yh.error || 'Yahoo Finance quote failed' };
  }

  if (host === 'stockanalysis.com' || host.endsWith('.stockanalysis.com')) {
    const fxCache = new Map<string, number>();
    const sa = await fetchStockAnalysisPriceInTzs(symbolHint, fxCache, rawUrl);
    if (sa.price !== null && sa.price > 0) {
      return {
        raw: `TZS ${sa.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        numeric: sa.price,
        sourceLabel: `StockAnalysis (${sa.resolvedSymbol || symbolHint || 'Quote'})`,
      };
    }
    return { raw: null, numeric: null, error: sa.error || 'StockAnalysis quote failed' };
  }

  const res = await fetchWithTimeout(parsed.toString());
  if (!res.ok) {
    return { raw: null, numeric: null, error: `HTTP ${res.status} from ${parsed.hostname}` };
  }
  const html = await res.text();
  const text = extractSpacedText(html, selector.trim() || 'body');
  if (!text) return { raw: null, numeric: null, error: 'Selector matched no text' };

  const pattern = regex.trim() ? new RegExp(regex.trim(), 'i') : /-?\d[\d,]*\.?\d*/;
  const match = text.match(pattern);
  if (!match) return { raw: null, numeric: null, error: 'Regex matched no value' };
  const extracted = (match[1] ?? match[0]).trim();
  return { raw: extracted, numeric: parseNumber(extracted) };
}

const RECEIPT_MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

const EXT_RECEIPT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

function matchesMagicBytes(buf: Buffer, mimeType: string): boolean {
  if (buf.length < 4) return false;
  if (mimeType === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mimeType === 'image/webp') {
    return (
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'application/pdf') {
    return buf.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  return false;
}

function safeResolveReceiptPath(receiptsDir: string, receiptId: string): string | null {
  const clean = receiptId.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(clean) || clean.includes('..')) {
    return null;
  }
  const resolved = path.resolve(receiptsDir, clean);
  if (!resolved.startsWith(receiptsDir + path.sep)) {
    return null;
  }
  return resolved;
}

function deleteReceiptFileIfUnused(database: DatabaseSync, receiptsDir: string, receiptId: string): void {
  if (!receiptId) return;
  const used = database
    .prepare('SELECT COUNT(*) AS c FROM transactions WHERE receipt_id = ?')
    .get(receiptId) as { c: number };
  if (used.c === 0) {
    const filePath = safeResolveReceiptPath(receiptsDir, receiptId);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}

// ----------------------------------------------------------------------------- Express App
async function startServer() {
  getMembersDb();
  sweepExpiredMembers();
  const expirySweepTimer = setInterval(() => {
    try {
      sweepExpiredMembers();
    } catch {
      // Ignore transient sweep errors
    }
  }, 5 * 60 * 1000);
  expirySweepTimer.unref();

  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.use('/api', (req, res, next) => {
    void requireUserAuth(req, res, next);
  });

  app.get('/api/state', (req, res) => {
    const { db } = getRequestUserContext(req);
    res.json(getFullState(db));
  });

  app.get('/api/market/live', async (_req, res) => {
    const [dse, utt] = await Promise.all([fetchDseBoard(), fetchUttAmisNavs()]);
    res.json({
      dse: dse.board,
      dseErrors: dse.errors,
      utt: utt.funds,
      uttAsOf: utt.asOf,
      uttError: utt.error,
    });
  });

  app.post('/api/settings', (req, res) => {
    const { db } = getRequestUserContext(req);
    const {
      language,
      target,
      autoRefreshOnOpen,
      onboardingCompleted,
      khumsEnabled,
      monthlyFixedExpenses,
    } = req.body ?? {};
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)');
    stmt.run('currency', 'TZS');
    if (language === 'en' || language === 'sw') {
      stmt.run('language', language);
    }
    if (target !== undefined && Number.isFinite(Number(target)) && Number(target) > 0) {
      stmt.run('target', String(Number(target)));
    }
    if (typeof autoRefreshOnOpen === 'boolean') {
      stmt.run('autoRefreshOnOpen', autoRefreshOnOpen ? 'true' : 'false');
    }
    if (typeof onboardingCompleted === 'boolean') {
      stmt.run('onboardingCompleted', onboardingCompleted ? 'true' : 'false');
    }
    if (typeof khumsEnabled === 'boolean') {
      stmt.run('khumsEnabled', khumsEnabled ? 'true' : 'false');
    }
    if (Array.isArray(monthlyFixedExpenses)) {
      const clean = sanitizeMonthlyFixedExpenses(monthlyFixedExpenses);
      stmt.run('monthlyFixedExpenses', JSON.stringify(clean));
    }
    res.json(getFullState(db));
  });

  // Freemium Billing, QR Code + WhatsApp Confirmation & Admin Endpoints
  app.get('/api/billing/config', (req, res) => {
    const { db } = getRequestUserContext(req);
    const current = getSettings(db);
    const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY?.trim());
    const pCfg = getPlatformBillingConfig();
    res.json({
      priceUsd: 5,
      priceTzsApprox: 13250,
      stripeConfigured,
      hasQrCode: pCfg.hasQrCode,
      qrUpdatedAt: pCfg.qrUpdatedAt,
      paymentInstructions: pCfg.paymentInstructions,
      whatsappNumber: pCfg.whatsappNumber,
      plan: current.plan,
      subscription: current.subscription,
    });
  });

  app.get('/api/billing/qr-image', (_req, res) => {
    const pCfg = getPlatformBillingConfig();
    if (!pCfg.hasQrCode || !pCfg.qrFilename) {
      return res.status(404).json({ error: 'QR code image has not been uploaded yet.' });
    }
    const resolved = safeResolveQrPath(pCfg.qrFilename);
    if (!resolved || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'QR code image not found.' });
    }
    res.setHeader('Content-Type', pCfg.qrMime || 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(resolved);
  });

  app.post('/api/billing/submit-claim', (req, res) => {
    const { db, uid, email, displayName } = getRequestUserContext(req);
    const current = getSettings(db);
    if (current.plan === 'pro') {
      return res.json({ state: getFullState(db) });
    }

    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const rawNote = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const cleanUsername = (rawUsername || displayName || email).slice(0, 100);
    const cleanNote = rawNote.slice(0, 160);
    const now = new Date().toISOString();

    const mdb = getMembersDb();
    mdb
      .prepare(
        `UPDATE members
         SET uid = COALESCE(NULLIF(?, ''), uid),
             payment_status = 'pending_verification',
             claim_username = ?,
             claim_note = ?,
             claimed_at = ?,
             last_seen_at = ?
         WHERE LOWER(email) = ?`
      )
      .run(uid, cleanUsername, cleanNote, now, now, email.toLowerCase());

    return res.json({ state: getFullState(db) });
  });

  app.post('/api/billing/create-checkout', async (req, res) => {
    const { db, uid, email } = getRequestUserContext(req);
    const current = getSettings(db);
    if (current.plan === 'pro') {
      return res.json({ mode: 'already_pro', state: getFullState(db) });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeKey) {
      return res.json({
        mode: 'sandbox',
        priceUsd: 5,
        priceTzsApprox: 13250,
      });
    }

    try {
      const origin = resolveSafeAppOrigin(req);
      const params = new URLSearchParams();
      params.set('mode', 'payment');
      params.set('success_url', `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
      params.set('cancel_url', `${origin}/?checkout=cancelled`);
      if (email) params.set('customer_email', email);
      params.set('line_items[0][price_data][currency]', 'usd');
      params.set('line_items[0][price_data][unit_amount]', '500');
      params.set('line_items[0][price_data][product_data][name]', 'FinanceDesk Pro');
      params.set(
        'line_items[0][price_data][product_data][description]',
        'One-time $5 upgrade unlocking AI Bank Statement Imports, Khums & TRA Taxes, and PDF/CSV Reports.'
      );
      params.set('line_items[0][quantity]', '1');
      params.set('metadata[uid]', uid);
      params.set('metadata[plan]', 'pro');

      const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const session = (await stripeRes.json()) as {
        id?: string;
        url?: string;
        error?: { message?: string };
      };
      if (!stripeRes.ok || !session.id || !session.url) {
        return res.status(502).json({
          error: session.error?.message || 'Unable to initialize Stripe Checkout session.',
        });
      }

      return res.json({
        mode: 'stripe',
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    } catch (e) {
      return res.status(502).json({
        error: (e as Error).message || 'Stripe checkout initialization failed.',
      });
    }
  });

  app.post('/api/billing/confirm-stripe', async (req, res) => {
    const { db, uid, email } = getRequestUserContext(req);
    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!stripeKey) {
      return res.status(400).json({ error: 'Stripe billing is not configured on this server.' });
    }

    const rawSessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    if (!/^cs_[a-zA-Z0-9_]{8,128}$/.test(rawSessionId)) {
      return res.status(400).json({ error: 'Invalid Stripe Checkout session identifier.' });
    }

    try {
      const stripeRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(rawSessionId)}`,
        {
          headers: {
            Authorization: `Bearer ${stripeKey}`,
          },
        }
      );
      const session = (await stripeRes.json()) as {
        id?: string;
        payment_status?: string;
        amount_total?: number;
        metadata?: { uid?: string };
        customer_details?: { email?: string };
        error?: { message?: string };
      };

      if (!stripeRes.ok) {
        return res.status(400).json({
          error: session.error?.message || 'Could not verify Stripe payment session.',
        });
      }
      if (session.payment_status !== 'paid' || Number(session.amount_total || 0) < 500) {
        return res.status(402).json({ error: 'Stripe payment has not been completed ($5.00 USD required).' });
      }
      if (session.metadata?.uid && session.metadata.uid !== uid) {
        return res.status(403).json({ error: 'Stripe session does not belong to this account.' });
      }

      const now = new Date().toISOString();
      const expiresAt = addDaysIso(now, MEMBERSHIP_DURATION_DAYS);
      const paymentRef = String(session.id || rawSessionId).slice(0, 80);
      const payerHint = String(session.customer_details?.email || email || 'Stripe').slice(0, 60);
      const sub: SubscriptionRecord = {
        plan: 'pro',
        paidAmountUsd: Number(session.amount_total || 500) / 100,
        paymentProvider: 'stripe',
        paymentRef,
        payerHint,
        paidAt: now,
        expiresAt,
        daysRemaining: MEMBERSHIP_DURATION_DAYS,
        claimStatus: 'paid',
        claimUsername: '',
        claimNote: '',
        claimedAt: '',
      };

      const mdb = getMembersDb();
      mdb
        .prepare(
          `UPDATE members
           SET membership_status = 'pro',
               payment_status = 'paid',
               payment_provider = 'stripe',
               payment_ref = ?,
               payer_hint = ?,
               paid_at = ?,
               expires_at = ?
           WHERE LOWER(email) = ?`
        )
        .run(paymentRef, payerHint, now, expiresAt, email.toLowerCase());

      const stmt = db.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)');
      stmt.run('plan', 'pro');
      stmt.run('subscriptionJson', JSON.stringify(sub));
      return res.json({ state: getFullState(db) });
    } catch (e) {
      return res.status(502).json({
        error: (e as Error).message || 'Failed to verify Stripe payment session.',
      });
    }
  });

  // Admin Dashboard Endpoints (Restricted to ADMIN_EMAIL_SET)
  app.get('/api/admin/overview', (req, res) => {
    if (!requireAdminUser(req, res)) return;
    const pCfg = getPlatformBillingConfig();
    res.json({
      users: listAdminUserRecords(),
      config: {
        hasQrCode: pCfg.hasQrCode,
        qrUpdatedAt: pCfg.qrUpdatedAt,
        paymentInstructions: pCfg.paymentInstructions,
        whatsappNumber: pCfg.whatsappNumber,
      },
    });
  });

  app.post('/api/admin/qr', (req, res) => {
    if (!requireAdminUser(req, res)) return;
    const { mimeType, dataBase64 } = req.body ?? {};
    if (
      typeof mimeType !== 'string' ||
      (mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp')
    ) {
      return res.status(400).json({ error: 'Only PNG, JPG, or WEBP QR code images are allowed.' });
    }
    if (typeof dataBase64 !== 'string' || !dataBase64.trim()) {
      return res.status(400).json({ error: 'QR code image content is required.' });
    }

    const stripped = dataBase64.includes(',') ? dataBase64.split(',').pop() || '' : dataBase64;
    const buf = Buffer.from(stripped, 'base64');
    if (buf.length === 0 || buf.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'QR image must be between 1 byte and 2 MB.' });
    }
    if (!matchesMagicBytes(buf, mimeType)) {
      return res.status(400).json({ error: 'QR image file content does not match its declared format.' });
    }

    const ext = RECEIPT_MIME_EXT[mimeType];
    const filename = `qr-${crypto.randomUUID()}${ext}`;
    const destPath = safeResolveQrPath(filename);
    if (!destPath) {
      return res.status(400).json({ error: 'Invalid QR code target path.' });
    }

    fs.mkdirSync(PLATFORM_QR_DIR, { recursive: true });
    const prevCfg = getPlatformBillingConfig();
    fs.writeFileSync(destPath, buf);

    if (prevCfg.qrFilename && prevCfg.qrFilename !== filename) {
      const oldPath = safeResolveQrPath(prevCfg.qrFilename);
      if (oldPath && fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    const now = new Date().toISOString();
    const pdb = getPlatformDb();
    const upsertCfg = pdb.prepare('INSERT OR REPLACE INTO platform_config (k, v) VALUES (?, ?)');
    upsertCfg.run('qrFilename', filename);
    upsertCfg.run('qrMime', mimeType);
    upsertCfg.run('qrUpdatedAt', now);

    res.json({
      ok: true,
      hasQrCode: true,
      qrUpdatedAt: now,
    });
  });

  app.delete('/api/admin/qr', (req, res) => {
    if (!requireAdminUser(req, res)) return;
    const prevCfg = getPlatformBillingConfig();
    if (prevCfg.qrFilename) {
      const oldPath = safeResolveQrPath(prevCfg.qrFilename);
      if (oldPath && fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    const pdb = getPlatformDb();
    const upsertCfg = pdb.prepare('INSERT OR REPLACE INTO platform_config (k, v) VALUES (?, ?)');
    upsertCfg.run('qrFilename', '');
    upsertCfg.run('qrMime', '');
    upsertCfg.run('qrUpdatedAt', '');

    res.json({
      ok: true,
      hasQrCode: false,
      qrUpdatedAt: '',
    });
  });

  app.post('/api/admin/billing-config', (req, res) => {
    if (!requireAdminUser(req, res)) return;
    const rawWa = typeof req.body?.whatsappNumber === 'string' ? req.body.whatsappNumber.replace(/\D/g, '') : '';
    const rawInstructions =
      typeof req.body?.paymentInstructions === 'string' ? req.body.paymentInstructions.trim().slice(0, 500) : '';

    if (rawWa && (rawWa.length < 8 || rawWa.length > 15)) {
      return res.status(400).json({ error: 'Enter a valid WhatsApp number with country code (8–15 digits).' });
    }

    const whatsappNumber = rawWa || DEFAULT_WHATSAPP_NUMBER;
    const pdb = getPlatformDb();
    const upsertCfg = pdb.prepare('INSERT OR REPLACE INTO platform_config (k, v) VALUES (?, ?)');
    upsertCfg.run('whatsappNumber', whatsappNumber);
    upsertCfg.run('paymentInstructions', rawInstructions);

    const pCfg = getPlatformBillingConfig();
    res.json({
      ok: true,
      config: {
        hasQrCode: pCfg.hasQrCode,
        qrUpdatedAt: pCfg.qrUpdatedAt,
        paymentInstructions: pCfg.paymentInstructions,
        whatsappNumber: pCfg.whatsappNumber,
      },
    });
  });

  app.post('/api/admin/users/plan', (req, res) => {
    if (!requireAdminUser(req, res)) return;
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const targetPlan: PlanTier | null =
      req.body?.plan === 'pro' ? 'pro' : req.body?.plan === 'free' ? 'free' : null;
    const rawRef = typeof req.body?.paymentRef === 'string' ? req.body.paymentRef.trim().slice(0, 80) : '';
    const rawNote = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 120) : '';

    if (!rawEmail || rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({ error: 'Enter a valid member Google email address.' });
    }
    if (!targetPlan) {
      return res.status(400).json({ error: 'Plan must be "pro" or "free".' });
    }

    const mdb = getMembersDb();
    sweepExpiredMembers(mdb);
    const existing = mdb
      .prepare('SELECT * FROM members WHERE LOWER(email) = ?')
      .get(rawEmail) as MemberSqlRow | undefined;
    const now = new Date().toISOString();
    const expiresAt = addDaysIso(now, MEMBERSHIP_DURATION_DAYS);

    if (targetPlan === 'pro') {
      const provider: PaymentProvider =
        existing?.payment_status === 'pending_verification' ? 'qr_whatsapp' : 'admin_manual';
      const paymentRef =
        rawRef || existing?.payment_ref || `ADM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const payerHint = rawNote || existing?.claim_username || existing?.display_name || rawEmail;

      if (existing) {
        mdb
          .prepare(
            `UPDATE members
             SET membership_status = 'pro',
                 payment_status = 'paid',
                 payment_provider = ?,
                 payment_ref = ?,
                 payer_hint = ?,
                 paid_at = ?,
                 expires_at = ?
             WHERE LOWER(email) = ?`
          )
          .run(provider, paymentRef, payerHint.slice(0, 60), now, expiresAt, rawEmail);
      } else {
        mdb
          .prepare(
            `INSERT INTO members (
               email, uid, display_name, membership_status, payment_status, payment_provider, payment_ref,
               payer_hint, claim_username, claim_note, claimed_at, paid_at, expires_at, last_seen_at, created_at
             ) VALUES (?, '', '', 'pro', 'paid', ?, ?, ?, '', ?, '', ?, ?, '', ?)`
          )
          .run(
            rawEmail,
            provider,
            paymentRef,
            payerHint.slice(0, 60),
            rawNote.slice(0, 160),
            now,
            expiresAt,
            now
          );
      }
    } else if (existing) {
      mdb
        .prepare(
          `UPDATE members
           SET membership_status = 'free',
               payment_status = 'none',
               payment_provider = 'none',
               payment_ref = '',
               payer_hint = '',
               paid_at = '',
               expires_at = ''
           WHERE LOWER(email) = ?`
        )
        .run(rawEmail);
    } else {
      mdb
        .prepare(
          `INSERT INTO members (
             email, uid, display_name, membership_status, payment_status, payment_provider, payment_ref,
             payer_hint, claim_username, claim_note, claimed_at, paid_at, expires_at, last_seen_at, created_at
           ) VALUES (?, '', '', 'free', 'none', 'none', '', '', '', '', '', '', '', '', ?)`
        )
        .run(rawEmail, now);
    }

    const updatedRow = mdb
      .prepare('SELECT uid FROM members WHERE LOWER(email) = ?')
      .get(rawEmail) as { uid: string } | undefined;
    if (updatedRow?.uid && userDbCache.has(updatedRow.uid)) {
      const targetDb = userDbCache.get(updatedRow.uid)!;
      getSettings(targetDb);
    }

    res.json({
      ok: true,
      users: listAdminUserRecords(),
    });
  });

  app.post('/api/admin/users/extend', (req, res) => {
    if (!requireAdminUser(req, res)) return;
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const parsedDays = Math.floor(Number(req.body?.days ?? MEMBERSHIP_DURATION_DAYS));
    const rawNote = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 120) : '';

    if (!rawEmail || rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return res.status(400).json({ error: 'Enter a valid member Google email address.' });
    }
    if (!Number.isFinite(parsedDays) || parsedDays < 1 || parsedDays > 365) {
      return res.status(400).json({ error: 'Extension days must be between 1 and 365.' });
    }

    const mdb = getMembersDb();
    sweepExpiredMembers(mdb);
    const existing = mdb
      .prepare('SELECT * FROM members WHERE LOWER(email) = ?')
      .get(rawEmail) as MemberSqlRow | undefined;
    const now = new Date().toISOString();

    if (existing && existing.membership_status === 'pro') {
      const currentExpiryMs = Date.parse(existing.expires_at);
      const baseAnchor =
        Number.isFinite(currentExpiryMs) && currentExpiryMs > Date.now() ? existing.expires_at : now;
      const newExpiresAt = addDaysIso(baseAnchor, parsedDays);
      mdb
        .prepare(
          `UPDATE members
           SET membership_status = 'pro',
               payment_status = 'paid',
               expires_at = ?,
               claim_note = CASE WHEN ? != '' THEN ? ELSE claim_note END
           WHERE LOWER(email) = ?`
        )
        .run(newExpiresAt, rawNote, rawNote, rawEmail);
    } else if (existing) {
      const newExpiresAt = addDaysIso(now, parsedDays);
      const paymentRef =
        existing.payment_ref || `ADM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const payerHint = rawNote || existing.claim_username || existing.display_name || rawEmail;
      mdb
        .prepare(
          `UPDATE members
           SET membership_status = 'pro',
               payment_status = 'paid',
               payment_provider = CASE WHEN payment_provider = 'none' THEN 'admin_manual' ELSE payment_provider END,
               payment_ref = ?,
               payer_hint = ?,
               paid_at = ?,
               expires_at = ?
           WHERE LOWER(email) = ?`
        )
        .run(paymentRef, payerHint.slice(0, 60), now, newExpiresAt, rawEmail);
    } else {
      const newExpiresAt = addDaysIso(now, parsedDays);
      const paymentRef = `ADM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      mdb
        .prepare(
          `INSERT INTO members (
             email, uid, display_name, membership_status, payment_status, payment_provider, payment_ref,
             payer_hint, claim_username, claim_note, claimed_at, paid_at, expires_at, last_seen_at, created_at
           ) VALUES (?, '', '', 'pro', 'paid', 'admin_manual', ?, ?, '', ?, '', ?, ?, '', ?)`
        )
        .run(rawEmail, paymentRef, (rawNote || rawEmail).slice(0, 60), rawNote, now, newExpiresAt, now);
    }

    const updatedRow = mdb
      .prepare('SELECT uid FROM members WHERE LOWER(email) = ?')
      .get(rawEmail) as { uid: string } | undefined;
    if (updatedRow?.uid && userDbCache.has(updatedRow.uid)) {
      const targetDb = userDbCache.get(updatedRow.uid)!;
      getSettings(targetDb);
    }

    res.json({
      ok: true,
      users: listAdminUserRecords(),
    });
  });

  app.post('/api/reports/authorize', (req, res) => {
    const { db } = getRequestUserContext(req);
    if (!requireProPlan(db, res, 'Report generation')) return;
    res.json({ ok: true, plan: 'pro' });
  });

  app.post('/api/calculators/khums-tax', (req, res) => {
    const { db } = getRequestUserContext(req);
    if (!requireProPlan(db, res, 'Khums & Tax calculators')) return;
    const body = req.body ?? {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid calculator configuration payload' });
    }

    const num = (val: unknown, max = 1e14): number => {
      const n = Number(val);
      return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
    };

    const sanitized = {
      khumsYearDate:
        typeof body.khumsYearDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.khumsYearDate)
          ? body.khumsYearDate
          : todayIso(),
      khumsMethod: body.khumsMethod === 'income_flow' ? 'income_flow' : 'wealth',
      khumsBankCash: num(body.khumsBankCash),
      khumsHandCash: num(body.khumsHandCash),
      khumsPortfolioValue: num(body.khumsPortfolioValue),
      khumsConsumablesValue: num(body.khumsConsumablesValue),
      khumsReceivables: num(body.khumsReceivables),
      khumsPriorPaidBasis: num(body.khumsPriorPaidBasis),
      khumsExemptReceipts: num(body.khumsExemptReceipts),
      khumsMaunahDebt: num(body.khumsMaunahDebt),
      khumsAnnualNetIncome: num(body.khumsAnnualNetIncome),
      khumsAnnualMaunahExpense: num(body.khumsAnnualMaunahExpense),

      traPayFrequency: body.traPayFrequency === 'annual' ? 'annual' : 'monthly',
      traEmploymentMode:
        body.traEmploymentMode === 'resident_secondary' ||
        body.traEmploymentMode === 'non_resident'
          ? body.traEmploymentMode
          : 'resident_primary',
      traGrossPay: num(body.traGrossPay),
      traNssfRatePct: num(body.traNssfRatePct, 50),
      traSecondaryIncomeAnnual: num(body.traSecondaryIncomeAnnual),
      traDseDividendsAnnual: num(body.traDseDividendsAnnual),
      traUnlistedDividendsAnnual: num(body.traUnlistedDividendsAnnual),
      traDseCapitalGainsAnnual: num(body.traDseCapitalGainsAnnual),
      traDseBelow25Pct: typeof body.traDseBelow25Pct === 'boolean' ? body.traDseBelow25Pct : true,
      traUnlistedCapitalGainsAnnual: num(body.traUnlistedCapitalGainsAnnual),
      traRentalInterestAnnual: num(body.traRentalInterestAnnual),
    };

    db.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)').run(
      'khumsTaxConfig',
      JSON.stringify(sanitized)
    );
    res.json(getFullState(db));
  });

  app.post('/api/state/restore', (req, res) => {
    const { db } = getRequestUserContext(req);
    const body = req.body ?? {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Invalid restore payload' });
    }

    const holdings = Array.isArray(body.holdings) ? body.holdings : [];
    const balances = Array.isArray(body.balances) ? body.balances : [];
    const transactions = Array.isArray(body.transactions) ? body.transactions : [];
    const indicators = Array.isArray(body.indicators) ? body.indicators : [];

    db.exec('BEGIN');
    try {
      if (holdings.length > 0) {
        db.exec('DELETE FROM holdings');
        const insHold = db.prepare(`
          INSERT INTO holdings (id, symbol, kind, units, cost, price, updated, date, source, url, selector, regex, native_currency)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TZS')
        `);
        const insHoldAuto = db.prepare(`
          INSERT INTO holdings (symbol, kind, units, cost, price, updated, date, source, url, selector, regex, native_currency)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TZS')
        `);
        for (const h of holdings) {
          if (!h || typeof h.symbol !== 'string' || !h.symbol.trim()) continue;
          const cleanRestoreUrl = typeof h.url === 'string' ? h.url.trim() : '';
          const src = normalizeHoldingSource(h.source, cleanRestoreUrl);
          const units = Math.max(0, Number(h.units) || 0);
          const cost = Math.max(0, Number(h.cost) || 0);
          const price = Math.max(0, Number(h.price) || 0);
          const args = [
            h.symbol.trim(),
            typeof h.kind === 'string' && h.kind.trim() ? h.kind.trim() : 'DSE Stock',
            units,
            cost,
            price,
            typeof h.updated === 'string' ? h.updated : '',
            typeof h.date === 'string' && h.date.trim() ? h.date.trim() : todayIso(),
            src,
            cleanRestoreUrl,
            typeof h.selector === 'string' ? h.selector.trim() : '',
            typeof h.regex === 'string' ? h.regex.trim() : '',
          ];
          if (Number.isInteger(Number(h.id)) && Number(h.id) > 0) {
            insHold.run(Number(h.id), ...args);
          } else {
            insHoldAuto.run(...args);
          }
        }
      }

      if (balances.length > 0) {
        db.exec('DELETE FROM balance');
        const insBal = db.prepare(
          "INSERT INTO balance (id, section, name, amount, date, type, native_currency) VALUES (?, ?, ?, ?, ?, ?, 'TZS')"
        );
        const insBalAuto = db.prepare(
          "INSERT INTO balance (section, name, amount, date, type, native_currency) VALUES (?, ?, ?, ?, ?, 'TZS')"
        );
        for (const b of balances) {
          if (!b || !VALID_SECTIONS.has(b.section) || typeof b.name !== 'string' || !b.name.trim()) continue;
          const amt = Number(b.amount);
          if (!Number.isFinite(amt)) continue;
          const args = [
            b.section,
            b.name.trim(),
            amt,
            typeof b.date === 'string' && b.date.trim() ? b.date.trim() : todayIso(),
            typeof b.type === 'string' && b.type.trim() ? b.type.trim() : 'Other',
          ];
          if (Number.isInteger(Number(b.id)) && Number(b.id) > 0) {
            insBal.run(Number(b.id), ...args);
          } else {
            insBalAuto.run(...args);
          }
        }
      }

      if (transactions.length > 0) {
        db.exec('DELETE FROM transactions');
        const insTx = db.prepare(
          "INSERT INTO transactions (id, date, activity, category, description, amount, native_currency, receipt_id, receipt_name, receipt_mime) VALUES (?, ?, ?, ?, ?, ?, 'TZS', ?, ?, ?)"
        );
        const insTxAuto = db.prepare(
          "INSERT INTO transactions (date, activity, category, description, amount, native_currency, receipt_id, receipt_name, receipt_mime) VALUES (?, ?, ?, ?, ?, 'TZS', ?, ?, ?)"
        );
        for (const t of transactions) {
          if (!t || !VALID_ACTIVITIES.has(t.activity) || typeof t.category !== 'string' || !t.category.trim()) continue;
          const amt = Number(t.amount);
          if (!Number.isFinite(amt)) continue;
          const args = [
            typeof t.date === 'string' && t.date.trim() ? t.date.trim() : todayIso(),
            t.activity,
            t.category.trim(),
            typeof t.description === 'string' ? t.description.trim() : '',
            amt,
            typeof t.receiptId === 'string' ? t.receiptId.trim().slice(0, 80) : '',
            typeof t.receiptName === 'string' ? t.receiptName.trim().slice(0, 200) : '',
            typeof t.receiptMime === 'string' ? t.receiptMime.trim().slice(0, 80) : '',
          ];
          if (Number.isInteger(Number(t.id)) && Number(t.id) > 0) {
            insTx.run(Number(t.id), ...args);
          } else {
            insTxAuto.run(...args);
          }
        }
      }

      if (indicators.length > 0) {
        db.exec('DELETE FROM indicators');
        const insInd = db.prepare(
          'INSERT INTO indicators (id, name, url, selector, regex, value, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        const insIndAuto = db.prepare(
          'INSERT INTO indicators (name, url, selector, regex, value, updated) VALUES (?, ?, ?, ?, ?, ?)'
        );
        for (const ind of indicators) {
          if (!ind || typeof ind.name !== 'string' || !ind.name.trim() || typeof ind.url !== 'string' || !ind.url.trim()) continue;
          const args = [
            ind.name.trim(),
            ind.url.trim(),
            typeof ind.selector === 'string' ? ind.selector.trim() : '',
            typeof ind.regex === 'string' ? ind.regex.trim() : '',
            typeof ind.value === 'string' ? ind.value : '-',
            typeof ind.updated === 'string' ? ind.updated : '',
          ];
          if (Number.isInteger(Number(ind.id)) && Number(ind.id) > 0) {
            insInd.run(Number(ind.id), ...args);
          } else {
            insIndAuto.run(...args);
          }
        }
      }

      const stmt = db.prepare('INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)');
      if (body.settings && typeof body.settings === 'object') {
        if (body.settings.language === 'en' || body.settings.language === 'sw') {
          stmt.run('language', body.settings.language);
        }
        const target = Number(body.settings.target);
        if (Number.isFinite(target) && target > 0) stmt.run('target', String(target));
        if (typeof body.settings.autoRefreshOnOpen === 'boolean') {
          stmt.run('autoRefreshOnOpen', body.settings.autoRefreshOnOpen ? 'true' : 'false');
        }
        if (typeof body.settings.onboardingCompleted === 'boolean') {
          stmt.run('onboardingCompleted', body.settings.onboardingCompleted ? 'true' : 'false');
        }
        if (typeof body.settings.khumsEnabled === 'boolean') {
          stmt.run('khumsEnabled', body.settings.khumsEnabled ? 'true' : 'false');
        }
        if (Array.isArray(body.settings.monthlyFixedExpenses)) {
          stmt.run(
            'monthlyFixedExpenses',
            JSON.stringify(sanitizeMonthlyFixedExpenses(body.settings.monthlyFixedExpenses))
          );
        }
      }
      if (body.khumsTaxConfig && typeof body.khumsTaxConfig === 'object') {
        stmt.run('khumsTaxConfig', JSON.stringify(body.khumsTaxConfig));
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: (e as Error).message });
    }

    res.json(getFullState(db));
  });

  // Balance CRUD
  app.post('/api/balance', (req, res) => {
    const { db } = getRequestUserContext(req);
    const { date, section, type, name, amount } = req.body ?? {};
    if (!VALID_SECTIONS.has(section)) return res.status(400).json({ error: 'Invalid balance section' });
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Description is required' });
    const num = Number(amount);
    if (!Number.isFinite(num)) return res.status(400).json({ error: 'Valid amount is required' });

    db.prepare(
      'INSERT INTO balance (section, name, amount, date, type, native_currency) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      section,
      name.trim(),
      num,
      typeof date === 'string' && date.trim() ? date.trim() : todayIso(),
      typeof type === 'string' && type.trim() ? type.trim() : 'Other',
      'TZS'
    );
    res.json(getFullState(db));
  });

  app.put('/api/balance/:id', (req, res) => {
    const { db } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    const { date, section, type, name, amount } = req.body ?? {};
    if (!VALID_SECTIONS.has(section)) return res.status(400).json({ error: 'Invalid balance section' });
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Description is required' });
    const num = Number(amount);
    if (!Number.isFinite(num)) return res.status(400).json({ error: 'Valid amount is required' });

    const result = db.prepare(
      'UPDATE balance SET section = ?, name = ?, amount = ?, date = ?, type = ?, native_currency = ? WHERE id = ?'
    ).run(
      section,
      name.trim(),
      num,
      typeof date === 'string' && date.trim() ? date.trim() : todayIso(),
      typeof type === 'string' && type.trim() ? type.trim() : 'Other',
      'TZS',
      id
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Balance entry not found — please refresh.' });
    }
    res.json(getFullState(db));
  });

  app.delete('/api/balance/:id', (req, res) => {
    const { db } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    db.prepare('DELETE FROM balance WHERE id = ?').run(id);
    res.json(getFullState(db));
  });

  app.post('/api/balance/transfer', (req, res) => {
    const { db } = getRequestUserContext(req);
    const { fromBank, toBank, amount, date } = req.body ?? {};
    const fromName = typeof fromBank === 'string' ? fromBank.trim() : '';
    const toName = typeof toBank === 'string' ? toBank.trim() : '';
    const amt = Number(amount);
    const transferDate = typeof date === 'string' && date.trim() ? date.trim() : todayIso();

    if (!fromName || !toName) {
      return res.status(400).json({ error: 'Both source and destination bank accounts are required.' });
    }
    if (fromName.toLowerCase() === toName.toLowerCase()) {
      return res.status(400).json({ error: 'Source and destination bank accounts must be different.' });
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: 'Transfer amount must be greater than zero.' });
    }

    try {
      db.exec('BEGIN');
      const fromRow = db
        .prepare(
          "SELECT id, name, amount FROM balance WHERE section = 'current_asset' AND type = 'Cash in bank' AND LOWER(name) = LOWER(?)"
        )
        .get(fromName) as { id: number; name: string; amount: number } | undefined;

      if (!fromRow) {
        db.exec('ROLLBACK');
        return res.status(400).json({
          error: `Source bank "${fromName}" does not exist in Current Assets yet.`,
        });
      }

      const currentBal = Number(fromRow.amount) || 0;
      if (currentBal < amt) {
        db.exec('ROLLBACK');
        return res.status(400).json({
          error: `Insufficient funds in ${fromRow.name} (${Math.round(currentBal).toLocaleString('en-US')} TZS available).`,
        });
      }

      db.prepare('UPDATE balance SET amount = ?, date = ? WHERE id = ?').run(
        currentBal - amt,
        transferDate,
        fromRow.id
      );

      const toRow = db
        .prepare(
          "SELECT id, name, amount FROM balance WHERE section = 'current_asset' AND type = 'Cash in bank' AND LOWER(name) = LOWER(?)"
        )
        .get(toName) as { id: number; name: string; amount: number } | undefined;

      if (toRow) {
        const destBal = Number(toRow.amount) || 0;
        db.prepare('UPDATE balance SET amount = ?, date = ? WHERE id = ?').run(
          destBal + amt,
          transferDate,
          toRow.id
        );
      } else {
        db.prepare(
          "INSERT INTO balance (section, name, amount, date, type, native_currency) VALUES ('current_asset', ?, ?, ?, 'Cash in bank', 'TZS')"
        ).run(toName, amt, transferDate);
      }

      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: (e as Error).message || 'Bank transfer failed.' });
    }

    res.json(getFullState(db));
  });

  // Receipts Upload & Protected Fetch
  app.post('/api/receipts', (req, res) => {
    const { receiptsDir } = getRequestUserContext(req);
    const { filename, mimeType, dataBase64 } = req.body ?? {};
    if (typeof mimeType !== 'string' || !RECEIPT_MIME_EXT[mimeType]) {
      return res.status(400).json({ error: 'Only JPG, PNG, WEBP, or PDF receipts are allowed.' });
    }
    if (typeof dataBase64 !== 'string' || !dataBase64.trim()) {
      return res.status(400).json({ error: 'Receipt file content is required.' });
    }

    const stripped = dataBase64.includes(',') ? dataBase64.split(',').pop() || '' : dataBase64;
    const buf = Buffer.from(stripped, 'base64');
    if (buf.length === 0 || buf.length > 4 * 1024 * 1024) {
      return res.status(400).json({ error: 'Receipt must be between 1 byte and 4 MB.' });
    }
    if (!matchesMagicBytes(buf, mimeType)) {
      return res.status(400).json({ error: 'Receipt file content does not match its declared type.' });
    }

    const ext = RECEIPT_MIME_EXT[mimeType];
    const receiptId = `${crypto.randomUUID()}${ext}`;
    const destPath = safeResolveReceiptPath(receiptsDir, receiptId);
    if (!destPath) {
      return res.status(400).json({ error: 'Invalid receipt target path.' });
    }

    fs.mkdirSync(receiptsDir, { recursive: true });
    fs.writeFileSync(destPath, buf);

    const safeName =
      typeof filename === 'string' && filename.trim()
        ? path.basename(filename.trim()).slice(0, 180)
        : `receipt${ext}`;

    res.json({
      receiptId,
      receiptName: safeName,
      receiptMime: mimeType,
    });
  });

  app.get('/api/receipts/:receiptId', (req, res) => {
    const { receiptsDir } = getRequestUserContext(req);
    const receiptId = String(req.params.receiptId || '');
    const resolved = safeResolveReceiptPath(receiptsDir, receiptId);
    if (!resolved || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Receipt file not found on this server.' });
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime = EXT_RECEIPT_MIME[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(resolved);
  });

  // Transactions CRUD
  app.post('/api/transactions', (req, res) => {
    const { db, receiptsDir } = getRequestUserContext(req);
    const { date, activity, category, description, amount, receiptId, receiptName, receiptMime } = req.body ?? {};
    if (!VALID_ACTIVITIES.has(activity)) return res.status(400).json({ error: 'Invalid activity' });
    if (typeof category !== 'string' || !category.trim()) return res.status(400).json({ error: 'Category is required' });
    const num = Number(amount);
    if (!Number.isFinite(num)) return res.status(400).json({ error: 'Valid amount is required' });

    const cleanReceiptId =
      typeof receiptId === 'string' && safeResolveReceiptPath(receiptsDir, receiptId)
        ? receiptId.trim().slice(0, 80)
        : '';
    const cleanReceiptName =
      cleanReceiptId && typeof receiptName === 'string' ? receiptName.trim().slice(0, 200) : '';
    const cleanReceiptMime =
      cleanReceiptId && typeof receiptMime === 'string' ? receiptMime.trim().slice(0, 80) : '';

    db.prepare(
      'INSERT INTO transactions (date, activity, category, description, amount, native_currency, receipt_id, receipt_name, receipt_mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      typeof date === 'string' && date.trim() ? date.trim() : todayIso(),
      activity,
      category.trim(),
      typeof description === 'string' ? description.trim() : '',
      num,
      'TZS',
      cleanReceiptId,
      cleanReceiptName,
      cleanReceiptMime
    );
    res.json(getFullState(db));
  });

  app.put('/api/transactions/:id', (req, res) => {
    const { db, receiptsDir } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    const { date, activity, category, description, amount, receiptId, receiptName, receiptMime } = req.body ?? {};
    if (!VALID_ACTIVITIES.has(activity)) return res.status(400).json({ error: 'Invalid activity' });
    if (typeof category !== 'string' || !category.trim()) return res.status(400).json({ error: 'Category is required' });
    const num = Number(amount);
    if (!Number.isFinite(num)) return res.status(400).json({ error: 'Valid amount is required' });

    const prev = db.prepare('SELECT receipt_id AS receiptId FROM transactions WHERE id = ?').get(id) as
      | { receiptId: string }
      | undefined;
    if (!prev) {
      return res.status(404).json({ error: 'Transaction not found — please refresh.' });
    }

    const cleanReceiptId =
      typeof receiptId === 'string' && safeResolveReceiptPath(receiptsDir, receiptId)
        ? receiptId.trim().slice(0, 80)
        : '';
    const cleanReceiptName =
      cleanReceiptId && typeof receiptName === 'string' ? receiptName.trim().slice(0, 200) : '';
    const cleanReceiptMime =
      cleanReceiptId && typeof receiptMime === 'string' ? receiptMime.trim().slice(0, 80) : '';

    db.prepare(
      'UPDATE transactions SET date = ?, activity = ?, category = ?, description = ?, amount = ?, native_currency = ?, receipt_id = ?, receipt_name = ?, receipt_mime = ? WHERE id = ?'
    ).run(
      typeof date === 'string' && date.trim() ? date.trim() : todayIso(),
      activity,
      category.trim(),
      typeof description === 'string' ? description.trim() : '',
      num,
      'TZS',
      cleanReceiptId,
      cleanReceiptName,
      cleanReceiptMime,
      id
    );

    if (prev.receiptId && prev.receiptId !== cleanReceiptId) {
      deleteReceiptFileIfUnused(db, receiptsDir, prev.receiptId);
    }

    res.json(getFullState(db));
  });

  app.delete('/api/transactions/:id', (req, res) => {
    const { db, receiptsDir } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    const prev = db.prepare('SELECT receipt_id AS receiptId FROM transactions WHERE id = ?').get(id) as
      | { receiptId: string }
      | undefined;
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    if (prev?.receiptId) {
      deleteReceiptFileIfUnused(db, receiptsDir, prev.receiptId);
    }
    res.json(getFullState(db));
  });

  app.post('/api/transactions/batch', (req, res) => {
    const { db } = getRequestUserContext(req);
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Provide at least one transaction.' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Batch limit is 50 transactions per request.' });
    }

    try {
      db.exec('BEGIN');
      const ins = db.prepare(
        "INSERT INTO transactions (date, activity, category, description, amount, native_currency, receipt_id, receipt_name, receipt_mime) VALUES (?, ?, ?, ?, ?, 'TZS', '', '', '')"
      );
      for (const item of items) {
        if (!item || typeof item !== 'object') {
          throw new Error('Invalid transaction item in batch.');
        }
        const { date, activity, category, description, amount } = item as Record<string, unknown>;
        if (!VALID_ACTIVITIES.has(String(activity))) {
          throw new Error('Invalid transaction activity in batch.');
        }
        if (typeof category !== 'string' || !category.trim()) {
          throw new Error('Category is required for every transaction.');
        }
        const num = Number(amount);
        if (!Number.isFinite(num) || num === 0) {
          throw new Error('Every transaction must have a valid non-zero amount.');
        }
        ins.run(
          typeof date === 'string' && date.trim() ? date.trim() : todayIso(),
          String(activity),
          category.trim(),
          typeof description === 'string' ? description.trim() : '',
          num
        );
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: (e as Error).message || 'Batch insert failed.' });
    }

    res.json(getFullState(db));
  });

  // Live quote lookup helper for Add/Edit Holding modal
  app.post('/api/holdings/quote', async (req, res) => {
    const { symbol, source, url, selector, regex } = req.body ?? {};
    const sym = typeof symbol === 'string' ? symbol.trim() : '';
    const cleanUrl = typeof url === 'string' ? url.trim() : '';
    const src = normalizeHoldingSource(source || 'Yahoo', cleanUrl);

    if (cleanUrl) {
      try {
        validateExternalUrl(cleanUrl);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
    }
    if (!sym && !cleanUrl) {
      return res.status(400).json({ error: 'Enter a ticker symbol or quote URL first' });
    }

    try {
      const fxCache = new Map<string, number>();
      if (src === 'DSE') {
        const dse = await fetchDseBoard();
        const hit = lookupDseBoardHit(sym, dse.board);
        if (!hit) {
          return res.status(404).json({
            error: dse.errors.join('; ') || `Ticker "${sym}" not found on DSE board`,
          });
        }
        return res.json({
          priceTzs: hit.price,
          resolvedSymbol: sym.toUpperCase(),
          nativePrice: hit.price,
          nativeCurrency: 'TZS',
          fxRate: 1,
          sourceLabel: hit.origin,
        });
      }
      if (src === 'UTT AMIS') {
        const utt = await fetchUttAmisNavs();
        const hit = matchUttFund(sym, utt.funds);
        if (!hit) return res.status(404).json({ error: `Fund "${sym}" not matched on UTT AMIS` });
        return res.json({
          priceTzs: hit.nav,
          resolvedSymbol: sym,
          nativePrice: hit.nav,
          nativeCurrency: 'TZS',
          fxRate: 1,
          sourceLabel: `UTT AMIS (${hit.asOf || 'NAV'})`,
        });
      }
      if (src === 'StockAnalysis') {
        const sa = await fetchStockAnalysisPriceInTzs(sym, fxCache, cleanUrl);
        if (sa.price === null) {
          return res.status(404).json({ error: sa.error || 'No StockAnalysis quote found' });
        }
        return res.json({
          priceTzs: sa.price,
          resolvedSymbol: sa.resolvedSymbol || sym,
          nativePrice: sa.nativePrice ?? sa.price,
          nativeCurrency: sa.nativeCurrency || 'USD',
          fxRate: sa.fxRate ?? 1,
          sourceLabel: `StockAnalysis (${sa.resolvedSymbol || sym})`,
        });
      }
      if (src === 'Web') {
        if (!cleanUrl) return res.status(400).json({ error: 'Quote URL is required for Web scraper' });
        const scraped = await scrapeGenericPage(
          cleanUrl,
          typeof selector === 'string' ? selector.trim() : '',
          typeof regex === 'string' ? regex.trim() : '',
          sym
        );
        if (scraped.numeric === null || scraped.numeric <= 0) {
          return res.status(404).json({ error: scraped.error || 'Could not extract price from page' });
        }
        return res.json({
          priceTzs: scraped.numeric,
          resolvedSymbol: sym || 'Web',
          nativePrice: scraped.numeric,
          nativeCurrency: 'TZS',
          fxRate: 1,
          sourceLabel: scraped.sourceLabel || 'Custom Web scraper',
        });
      }

      // Yahoo (yfinance v8) + StockAnalysis fallback
      const yh = await fetchYahooPriceInTzs(sym, fxCache, cleanUrl);
      if (yh.price === null) {
        return res.status(404).json({ error: yh.error || 'No quote found on Yahoo Finance' });
      }
      return res.json({
        priceTzs: yh.price,
        resolvedSymbol: yh.resolvedSymbol || sym,
        nativePrice: yh.nativePrice ?? yh.price,
        nativeCurrency: yh.nativeCurrency || 'USD',
        fxRate: yh.fxRate ?? 1,
        sourceLabel: yh.sourceLabel || `Yahoo Finance (${yh.resolvedSymbol || sym})`,
      });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message || 'Live quote lookup failed' });
    }
  });

  // Holdings CRUD
  app.post('/api/holdings', async (req, res) => {
    const { db } = getRequestUserContext(req);
    const { symbol, kind, units, cost, date, price, source, url, selector, regex } = req.body ?? {};
    if (typeof symbol !== 'string' || !symbol.trim()) return res.status(400).json({ error: 'Symbol is required' });
    const cleanUrl = typeof url === 'string' ? url.trim() : '';
    const src = normalizeHoldingSource(source, cleanUrl);
    if (cleanUrl) {
      try {
        validateExternalUrl(cleanUrl);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
    }

    const parsedUnits = Number(units);
    const parsedCost = Number(cost);
    let parsedPrice = Number(price);
    if (!Number.isFinite(parsedUnits) || parsedUnits < 0 || !Number.isFinite(parsedCost) || parsedCost < 0 || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'Units, cost, and price must be valid non-negative numbers' });
    }

    let updatedLabel = src === 'Fixed' ? 'Fixed until daily public updates' : '';
    if (parsedPrice === 0 && src !== 'Fixed' && src !== 'Manual') {
      try {
        const fxCache = new Map<string, number>();
        if (src === 'DSE') {
          const dse = await fetchDseBoard();
          const hit = lookupDseBoardHit(symbol, dse.board);
          if (hit) {
            parsedPrice = hit.price;
            updatedLabel = nowStamp();
          }
        } else if (src === 'UTT AMIS') {
          const utt = await fetchUttAmisNavs();
          const hit = matchUttFund(symbol.trim(), utt.funds);
          if (hit) {
            parsedPrice = hit.nav;
            updatedLabel = nowStamp();
          }
        } else if (src === 'Investing.com') {
          const [dse, utt] = await Promise.all([fetchDseBoard(), fetchUttAmisNavs()]);
          const inv = await resolveInvestingComPrice(symbol.trim(), cleanUrl, dse.board, utt.funds, fxCache);
          if (inv.price !== null && inv.price > 0) {
            parsedPrice = inv.price;
            updatedLabel = nowStamp();
          }
        } else if (src === 'Yahoo') {
          const yh = await fetchYahooPriceInTzs(symbol.trim(), fxCache, cleanUrl);
          if (yh.price !== null && yh.price > 0) {
            parsedPrice = yh.price;
            updatedLabel = nowStamp();
          }
        } else if (src === 'StockAnalysis') {
          const sa = await fetchStockAnalysisPriceInTzs(symbol.trim(), fxCache, cleanUrl);
          if (sa.price !== null && sa.price > 0) {
            parsedPrice = sa.price;
            updatedLabel = nowStamp();
          }
        } else if (src === 'Web' && cleanUrl) {
          const scraped = await scrapeGenericPage(
            cleanUrl,
            typeof selector === 'string' ? selector.trim() : '',
            typeof regex === 'string' ? regex.trim() : ''
          );
          if (scraped.numeric !== null && scraped.numeric > 0) {
            parsedPrice = scraped.numeric;
            updatedLabel = nowStamp();
          }
        }
      } catch {
        // Save cleanly even if live lookup fails
      }
    } else if (parsedPrice > 0 && src !== 'Fixed') {
      updatedLabel = nowStamp();
    }

    db.prepare(`
      INSERT INTO holdings (symbol, kind, units, cost, price, updated, date, source, url, selector, regex, native_currency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      symbol.trim(),
      typeof kind === 'string' && kind.trim() ? kind.trim() : 'DSE Stock',
      parsedUnits,
      parsedCost,
      parsedPrice,
      updatedLabel,
      typeof date === 'string' && date.trim() ? date.trim() : todayIso(),
      src,
      cleanUrl,
      typeof selector === 'string' ? selector.trim() : '',
      typeof regex === 'string' ? regex.trim() : '',
      'TZS'
    );
    res.json(getFullState(db));
  });

  app.put('/api/holdings/:id', async (req, res) => {
    const { db } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    const { symbol, kind, units, cost, date, price, source, url, selector, regex } = req.body ?? {};
    if (typeof symbol !== 'string' || !symbol.trim()) return res.status(400).json({ error: 'Symbol is required' });
    const cleanUrl = typeof url === 'string' ? url.trim() : '';
    const src = normalizeHoldingSource(source, cleanUrl);
    if (cleanUrl) {
      try {
        validateExternalUrl(cleanUrl);
      } catch (e) {
        return res.status(400).json({ error: (e as Error).message });
      }
    }

    const parsedUnits = Number(units);
    const parsedCost = Number(cost);
    let parsedPrice = Number(price);
    if (!Number.isFinite(parsedUnits) || parsedUnits < 0 || !Number.isFinite(parsedCost) || parsedCost < 0 || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'Units, cost, and price must be valid non-negative numbers' });
    }

    let existing = db.prepare('SELECT id, updated FROM holdings WHERE id = ?').get(id) as
      | { id: number; updated: string }
      | undefined;

    if (!existing) {
      existing = db
        .prepare('SELECT id, updated FROM holdings WHERE LOWER(symbol) = LOWER(?)')
        .get(symbol.trim()) as { id: number; updated: string } | undefined;
    }

    if (!existing) {
      return res.status(404).json({ error: 'Holding not found — please refresh the list.' });
    }

    let updatedLabel =
      src === 'Fixed' ? 'Fixed until daily public updates' : existing.updated || nowStamp();

    if (parsedPrice === 0 && src !== 'Fixed' && src !== 'Manual') {
      try {
        const fxCache = new Map<string, number>();
        if (src === 'Investing.com') {
          const [dse, utt] = await Promise.all([fetchDseBoard(), fetchUttAmisNavs()]);
          const inv = await resolveInvestingComPrice(symbol.trim(), cleanUrl, dse.board, utt.funds, fxCache);
          if (inv.price !== null && inv.price > 0) {
            parsedPrice = inv.price;
            updatedLabel = nowStamp();
          }
        } else if (src === 'DSE') {
          const dse = await fetchDseBoard();
          const hit = lookupDseBoardHit(symbol, dse.board);
          if (hit) {
            parsedPrice = hit.price;
            updatedLabel = nowStamp();
          }
        } else if (src === 'UTT AMIS') {
          const utt = await fetchUttAmisNavs();
          const hit = matchUttFund(symbol.trim(), utt.funds);
          if (hit) {
            parsedPrice = hit.nav;
            updatedLabel = nowStamp();
          }
        } else if (src === 'Yahoo') {
          const yh = await fetchYahooPriceInTzs(symbol.trim(), fxCache, cleanUrl);
          if (yh.price !== null && yh.price > 0) {
            parsedPrice = yh.price;
            updatedLabel = nowStamp();
          }
        } else if (src === 'StockAnalysis') {
          const sa = await fetchStockAnalysisPriceInTzs(symbol.trim(), fxCache, cleanUrl);
          if (sa.price !== null && sa.price > 0) {
            parsedPrice = sa.price;
            updatedLabel = nowStamp();
          }
        }
      } catch {
        // Keep 0 if live lookup fails
      }
    }

    db.prepare(`
      UPDATE holdings
      SET symbol = ?, kind = ?, units = ?, cost = ?, price = ?, updated = ?, date = ?, source = ?, url = ?, selector = ?, regex = ?, native_currency = ?
      WHERE id = ?
    `).run(
      symbol.trim(),
      typeof kind === 'string' && kind.trim() ? kind.trim() : 'DSE Stock',
      parsedUnits,
      parsedCost,
      parsedPrice,
      updatedLabel,
      typeof date === 'string' && date.trim() ? date.trim() : todayIso(),
      src,
      cleanUrl,
      typeof selector === 'string' ? selector.trim() : '',
      typeof regex === 'string' ? regex.trim() : '',
      'TZS',
      existing.id
    );
    res.json(getFullState(db));
  });

  app.delete('/api/holdings/:id', (req, res) => {
    const { db } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    db.prepare('DELETE FROM holdings WHERE id = ?').run(id);
    res.json(getFullState(db));
  });

  app.post('/api/holdings/starter', (req, res) => {
    const { db } = getRequestUserContext(req);
    seedStarterHoldings(db, false);
    res.json(getFullState(db));
  });

  // Indicators CRUD
  app.post('/api/indicators', (req, res) => {
    const { db } = getRequestUserContext(req);
    const { name, url, selector, regex } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Indicator name is required' });
    if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'URL is required' });
    try {
      validateExternalUrl(url);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }

    db.prepare('INSERT INTO indicators (name, url, selector, regex, value, updated) VALUES (?, ?, ?, ?, ?, ?)').run(
      name.trim(),
      url.trim(),
      typeof selector === 'string' ? selector.trim() : '',
      typeof regex === 'string' ? regex.trim() : '',
      '-',
      ''
    );
    res.json(getFullState(db));
  });

  app.put('/api/indicators/:id', (req, res) => {
    const { db } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    const { name, url, selector, regex } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Indicator name is required' });
    if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'URL is required' });
    try {
      validateExternalUrl(url);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }

    db.prepare('UPDATE indicators SET name = ?, url = ?, selector = ?, regex = ? WHERE id = ?').run(
      name.trim(),
      url.trim(),
      typeof selector === 'string' ? selector.trim() : '',
      typeof regex === 'string' ? regex.trim() : '',
      id
    );
    res.json(getFullState(db));
  });

  app.delete('/api/indicators/:id', (req, res) => {
    const { db } = getRequestUserContext(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ID' });
    db.prepare('DELETE FROM indicators WHERE id = ?').run(id);
    res.json(getFullState(db));
  });

  // Live Price Refresh
  app.post('/api/prices/refresh', async (req, res) => {
    const { db } = getRequestUserContext(req);
    const holdings = db.prepare('SELECT * FROM holdings ORDER BY symbol ASC').all() as Array<{
      id: number;
      symbol: string;
      kind: string;
      source: string;
      url: string;
      selector: string;
      regex: string;
    }>;

    const needsDse = holdings.some((h) => h.source === 'DSE' || h.source === 'Investing.com');
    const needsUtt = holdings.some((h) => h.source === 'UTT AMIS');

    const [dseResult, uttResult] = await Promise.all([
      needsDse ? fetchDseBoard(true) : Promise.resolve({ board: {} as BoardMap, errors: [] as string[] }),
      needsUtt
        ? fetchUttAmisNavs()
        : Promise.resolve({ funds: {} as UttMap, asOf: '', error: undefined as string | undefined }),
    ]);

    const stamp = nowStamp();
    const updatePrice = db.prepare('UPDATE holdings SET price = ?, updated = ? WHERE id = ?');
    const updatePriceAndSource = db.prepare(
      'UPDATE holdings SET price = ?, updated = ?, source = ? WHERE id = ?'
    );
    const fxCache = new Map<string, number>();

    let updatedCount = 0;
    let skippedFixedCount = 0;
    const failed: Array<{ symbol: string; reason: string }> = [];
    const details: Array<{ symbol: string; price: number; source: string }> = [];

    for (const h of holdings) {
      const originalSrc = h.source || 'Manual';
      const src = normalizeHoldingSource(originalSrc, h.url || '');
      if (src === 'Fixed' || src === 'Manual') {
        if (src === 'Fixed') skippedFixedCount += 1;
        continue;
      }

      let px: number | null = null;
      let resolvedSource = src;
      let reason = 'No price found';

      try {
        if (src === 'DSE') {
          const hit = lookupDseBoardHit(h.symbol, dseResult.board);
          if (hit) {
            px = hit.price;
            resolvedSource = hit.origin;
          } else {
            reason = dseResult.errors.join('; ') || `Ticker ${h.symbol} not found on DSE board`;
          }
        } else if (src === 'UTT AMIS') {
          const hit = matchUttFund(h.symbol, uttResult.funds);
          if (hit) {
            px = hit.nav;
            resolvedSource = `UTT AMIS (${hit.asOf || 'NAV'})`;
          } else {
            reason = uttResult.error || `Fund "${h.symbol}" not matched on UTT AMIS`;
          }
        } else if (src === 'Investing.com') {
          const inv = await resolveInvestingComPrice(
            h.symbol,
            h.url,
            dseResult.board,
            uttResult.funds,
            fxCache
          );
          if (inv.price !== null) {
            px = inv.price;
            resolvedSource = inv.sourceLabel || 'Yahoo Finance';
          } else {
            reason = inv.error || 'International lookup failed';
          }
        } else if (src === 'Yahoo') {
          const yh = await fetchYahooPriceInTzs(h.symbol, fxCache, h.url);
          if (yh.price !== null) {
            px = yh.price;
            resolvedSource = yh.sourceLabel || (yh.resolvedSymbol ? `Yahoo (${yh.resolvedSymbol})` : 'Yahoo Finance');
          } else {
            reason = yh.error || 'Yahoo Finance lookup failed';
          }
        } else if (src === 'StockAnalysis') {
          const sa = await fetchStockAnalysisPriceInTzs(h.symbol, fxCache, h.url);
          if (sa.price !== null) {
            px = sa.price;
            resolvedSource = `StockAnalysis (${sa.resolvedSymbol || h.symbol})`;
          } else {
            reason = sa.error || 'StockAnalysis lookup failed';
          }
        } else if (src === 'Web') {
          if (!h.url) {
            reason = 'No URL configured';
          } else {
            const scraped = await scrapeGenericPage(h.url, h.selector, h.regex, h.symbol);
            if (scraped.numeric !== null) {
              px = scraped.numeric;
              resolvedSource = scraped.sourceLabel || 'Web scraper';
            } else {
              reason = scraped.error || 'Could not extract number';
            }
          }
        }
      } catch (e) {
        reason = (e as Error).message;
      }

      if (px !== null && Number.isFinite(px) && px > 0) {
        if (src !== originalSrc) {
          updatePriceAndSource.run(px, stamp, src, h.id);
        } else {
          updatePrice.run(px, stamp, h.id);
        }
        updatedCount += 1;
        details.push({ symbol: h.symbol, price: px, source: resolvedSource });
      } else {
        failed.push({ symbol: h.symbol, reason });
      }
    }

    const message =
      `Updated ${updatedCount} live price(s) in TZS` +
      (skippedFixedCount > 0 ? ` · ${skippedFixedCount} fixed holding(s) preserved` : '') +
      (failed.length > 0 ? ` · ${failed.length} failed` : '');

    res.json({
      updatedCount,
      skippedFixedCount,
      failed,
      details,
      message,
      state: getFullState(db),
    });
  });

  // Live Indicators Refresh
  app.post('/api/indicators/refresh', async (req, res) => {
    const { db } = getRequestUserContext(req);
    const indicators = db.prepare('SELECT * FROM indicators ORDER BY name ASC').all() as Array<{
      id: number;
      name: string;
      url: string;
      selector: string;
      regex: string;
    }>;

    const needsDse = indicators.some((i) => i.regex.startsWith('DSE_'));
    const needsUtt = indicators.some((i) => i.regex.startsWith('UTT_'));

    const [dseResult, uttResult] = await Promise.all([
      needsDse ? fetchDseBoard(true) : Promise.resolve({ board: {} as BoardMap, errors: [] as string[] }),
      needsUtt
        ? fetchUttAmisNavs()
        : Promise.resolve({ funds: {} as UttMap, asOf: '', error: undefined as string | undefined }),
    ]);

    const stamp = nowStamp();
    const updateInd = db.prepare('UPDATE indicators SET value = ?, updated = ? WHERE id = ?');
    let updatedCount = 0;

    for (const ind of indicators) {
      let val = 'n/a';
      try {
        if (ind.regex.startsWith('UTT_')) {
          const fundKey = ind.regex.replace('UTT_', '');
          const hit = matchUttFund(fundKey, uttResult.funds);
          if (hit) {
            val = `TZS ${hit.nav.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
            updatedCount += 1;
          }
        } else if (ind.regex.startsWith('DSE_')) {
          const ticker = ind.regex.replace('DSE_', '').toUpperCase();
          const hit = lookupDseBoardHit(ticker, dseResult.board);
          if (hit) {
            val = `TZS ${hit.price.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`;
            updatedCount += 1;
          }
        } else {
          const scraped = await scrapeGenericPage(ind.url, ind.selector, ind.regex, ind.name);
          if (scraped.raw) {
            val = scraped.raw;
            updatedCount += 1;
          } else if (scraped.error) {
            val = `err: ${scraped.error.slice(0, 40)}`;
          }
        }
      } catch (e) {
        val = `err: ${(e as Error).message.slice(0, 40)}`;
      }
      updateInd.run(val, stamp, ind.id);
    }

    res.json({
      updatedCount,
      message: `Updated ${updatedCount} indicator(s)`,
      state: getFullState(db),
    });
  });

  // ---------------------------------------------------------------------------
  // AI Bank Statement Parsing & Sorting (Server-Side @google/genai)
  // ---------------------------------------------------------------------------
  const STATEMENT_CATEGORIES = new Set([
    'Salary',
    'Business income',
    'Gifts received',
    'Investment income',
    'Other income',
    'Investment sale',
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
    'Other',
  ]);
  const VALID_BALANCE_TYPES = new Set([
    'Cash in bank',
    'Cash in hand',
    'Receivable',
    'Payable',
    'Property',
    'Loan',
    'Other',
  ]);
  const VALID_HOLDING_KINDS = new Set(['DSE Stock', 'ETF', 'Bond', 'Fund', 'Stock', 'Other']);
  const VALID_TARGET_SECTIONS = new Set([
    'cashflow',
    'current_asset',
    'current_liability',
    'longterm_asset',
    'longterm_liability',
    'holding',
  ]);
  const STATEMENT_BINARY_MIMES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);
  const STATEMENT_TEXT_MIMES = new Set([
    'text/csv',
    'text/plain',
    'application/csv',
    'application/vnd.ms-excel',
  ]);

  function normalizeIsoDate(raw: unknown): string {
    if (typeof raw !== 'string') return todayIso();
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
      const dd = dmy[1].padStart(2, '0');
      const mm = dmy[2].padStart(2, '0');
      return `${dmy[3]}-${mm}-${dd}`;
    }
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return todayIso();
  }

  app.post('/api/bank-statement/parse', async (req, res) => {
    const { db } = getRequestUserContext(req);
    if (!requireProPlan(db, res, 'AI Statement Import')) return;
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(500).json({
        error:
          'Gemini API key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.',
      });
    }

    const { filename, mimeType, dataBase64, textContent, bankNameHint } = req.body ?? {};
    const cleanName = typeof filename === 'string' ? filename.trim() : 'statement';
    const cleanMime = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
    const bankHint = typeof bankNameHint === 'string' ? bankNameHint.trim() : '';

    let extractedText = typeof textContent === 'string' ? textContent.trim() : '';
    let binaryPart: { inlineData: { mimeType: string; data: string } } | null = null;

    if (!extractedText) {
      if (typeof dataBase64 !== 'string' || !dataBase64.trim()) {
        return res.status(400).json({
          error: 'Upload a bank statement file (PDF, CSV, TXT, PNG, JPG, WEBP) or paste statement text.',
        });
      }
      const stripped = dataBase64.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(stripped, 'base64');
      if (buf.length === 0 || buf.length > 6 * 1024 * 1024) {
        return res.status(400).json({ error: 'Statement file must be non-empty and under 6 MB.' });
      }

      const isTextExt = /\.(csv|txt|tsv)$/i.test(cleanName);
      if (STATEMENT_TEXT_MIMES.has(cleanMime) || (!cleanMime && isTextExt)) {
        extractedText = buf.toString('utf8').trim();
      } else if (STATEMENT_BINARY_MIMES.has(cleanMime)) {
        binaryPart = { inlineData: { mimeType: cleanMime, data: stripped } };
      } else if (cleanName.toLowerCase().endsWith('.pdf')) {
        binaryPart = { inlineData: { mimeType: 'application/pdf', data: stripped } };
      } else {
        return res.status(400).json({
          error: 'Unsupported file type. Upload PDF, CSV, TXT, PNG, JPG, or WEBP.',
        });
      }
    }

    if (extractedText && extractedText.length > 250000) {
      extractedText = extractedText.slice(0, 250000);
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const systemInstruction = `You are a meticulous financial analyst for FinanceDesk, a personal wealth ledger strictly in Tanzanian Shillings (TZS).
Extract every transaction or financial position from the provided bank, mobile money (Selcom, Stanbic, Tigo Pesa / Mixx by Yas, CRDB, NMB, M-Pesa), or brokerage statement and sort each line into the most accurate FinanceDesk section:

1. targetSection = "cashflow": Everyday inflows and outflows (Cash Flow Ledger).
   - activity:
     * "operating": Salary, business receipts, rent, groceries/food, utilities/LUKU/data/airtime, transport/fuel, health, education, charity/khums/sadaqah, family support, bank/mobile charges.
     * "investing": Purchases or sales of stocks (DSE/global), UTT AMIS funds, ETFs, bonds, land/property deposits.
     * "financing": Loan repayments, loan disbursements received, credit repayments, owner drawings/capital.
   - direction: "income" for credits/deposits/inflows, "expense" for debits/withdrawals/payments/charges.
   - category MUST be chosen from: Salary, Business income, Gifts received, Investment income, Other income, Investment sale, Rent, Food & groceries, Transport, Utilities & data, Education, Health, Charity, Family support, Loan repayment, Investment purchase, Other.
2. targetSection = "holding": ONLY when the statement explicitly represents a custody/brokerage/UTT AMIS holding purchase or position with clear units and unit cost (set holdingSymbol, holdingKind, holdingUnits, holdingCost, holdingSource). If it's a normal bank transfer to a broker with no unit count, keep it in "cashflow" with activity="investing" and category="Investment purchase".
3. targetSection = "current_asset" / "current_liability" / "longterm_asset" / "longterm_liability": ONLY if the document explicitly lists ending receivables, payables, loans, or asset balances rather than cash movement lines.
4. All amounts MUST be positive numbers in TZS (convert/note in description if another currency appears, e.g., using ~2,650 TZS/USD if no statement FX rate is shown).
5. Also extract closingBalance (the statement ending bank/wallet balance if visible) and statementFrom / statementTo dates (YYYY-MM-DD).
6. Rename cryptic descriptions into clean, readable names WITHOUT completely stripping recognizable details:
   - Remove noisy bank/POS codes, transaction references (TXN..., FT..., REF...), timestamps, card masks, and boilerplate ("POS PURCHASE", "MOBILE TRF DR", "EFT CR").
   - Keep the actual merchant, payee/recipient name, utility/service name, or short branch/location context intact in clean Title Case.
   - Examples: "POS PURCHASE SHOPPERS SUPERMARKET MASAKI TXN99412" -> "Shoppers Supermarket (Masaki)"; "LUKU TOKEN 54238192011 TANESCO" -> "LUKU Electricity (TANESCO)"; "MIXX BY YAS TO 255713001122 JOHN DOE" -> "Transfer to John Doe (Mixx)"; "STANBIC SALARY CR ACME LTD REF 8821" -> "Salary - Acme Ltd"; "ATM WDL STANBIC OYSTERBAY 14:22" -> "ATM Withdrawal (Stanbic Oysterbay)".
   - Do NOT over-simplify into bare generic words like "Groceries" or "Transfer" when the counterparty/vendor is known.
   - Always also capture the original raw narration text from the statement in rawDescription.
7. Do NOT invent rows. Skip summary total rows, carried-forward balances, and header rows from the transaction list.`;

    const promptText = `Analyze this bank/financial statement${bankHint ? ` (Bank/Wallet hint: ${bankHint})` : ''} (${cleanName}) and return sorted entries for FinanceDesk.${
      extractedText ? `\n\nSTATEMENT CONTENT:\n${extractedText}` : ''
    }`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = binaryPart
      ? [binaryPart, { text: promptText }]
      : [{ text: promptText }];

    let rawJsonText = '';
    let lastAiError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: { parts },
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                bankDetected: {
                  type: Type.STRING,
                  description: 'Detected bank or mobile money institution name, e.g., Stanbic, Selcom, Tigo Pesa.',
                },
                statementFrom: {
                  type: Type.STRING,
                  description: 'Statement start date in YYYY-MM-DD format if present.',
                },
                statementTo: {
                  type: Type.STRING,
                  description: 'Statement end date in YYYY-MM-DD format if present.',
                },
                closingBalanceAmount: {
                  type: Type.NUMBER,
                  description: 'Closing balance in TZS if explicitly stated, otherwise 0.',
                },
                closingBalanceDate: {
                  type: Type.STRING,
                  description: 'Closing balance date in YYYY-MM-DD format if present.',
                },
                summary: {
                  type: Type.STRING,
                  description: 'Concise 1-2 sentence overview of what was extracted and sorted.',
                },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      targetSection: {
                        type: Type.STRING,
                        description:
                          'One of: cashflow, current_asset, current_liability, longterm_asset, longterm_liability, holding.',
                      },
                      date: { type: Type.STRING, description: 'Transaction or entry date YYYY-MM-DD.' },
                      activity: {
                        type: Type.STRING,
                        description: 'For cashflow: operating, investing, or financing.',
                      },
                      direction: {
                        type: Type.STRING,
                        description: 'income or expense.',
                      },
                      category: {
                        type: Type.STRING,
                        description: 'Matched FinanceDesk cashflow category.',
                      },
                      balanceType: {
                        type: Type.STRING,
                        description:
                          'For balance sections: Cash in bank, Cash in hand, Receivable, Payable, Property, Loan, or Other.',
                      },
                      description: {
                        type: Type.STRING,
                        description:
                          'Readable cleaned description that removes bank codes/IDs while keeping key merchant, payee, or service context.',
                      },
                      rawDescription: {
                        type: Type.STRING,
                        description: 'Original statement narration line before renaming.',
                      },
                      amount: {
                        type: Type.NUMBER,
                        description: 'Positive amount in TZS.',
                      },
                      holdingSymbol: { type: Type.STRING },
                      holdingKind: { type: Type.STRING },
                      holdingUnits: { type: Type.NUMBER },
                      holdingCost: { type: Type.NUMBER },
                      confidence: { type: Type.STRING, description: 'high, medium, or low' },
                      reason: { type: Type.STRING, description: 'Short classification rationale.' },
                    },
                    required: ['targetSection', 'date', 'direction', 'description', 'amount'],
                  },
                },
              },
              required: ['bankDetected', 'summary', 'items'],
            },
          },
        });
        rawJsonText = (response.text ?? '').trim();
        lastAiError = null;
        break;
      } catch (err) {
        lastAiError = err;
        const msg = (err as Error).message || '';
        if (/403|400|PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)) {
          break;
        }
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }

    if (lastAiError || !rawJsonText) {
      const msg = (lastAiError as Error)?.message || 'AI statement parsing failed.';
      if (/403|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) {
        return res.status(403).json({
          error: 'Gemini API key error. Verify GEMINI_API_KEY in Settings > Secrets.',
        });
      }
      if (/429|RESOURCE_EXHAUSTED/i.test(msg)) {
        return res.status(429).json({
          error: 'Gemini API quota temporarily reached. Please wait a moment and retry.',
        });
      }
      return res.status(502).json({ error: `AI statement analysis failed: ${msg}` });
    }

    let parsed: {
      bankDetected?: string;
      statementFrom?: string;
      statementTo?: string;
      closingBalanceAmount?: number;
      closingBalanceDate?: string;
      summary?: string;
      items?: Array<Record<string, unknown>>;
    };
    try {
      parsed = JSON.parse(rawJsonText);
    } catch {
      return res.status(502).json({ error: 'AI returned malformed statement JSON. Please retry.' });
    }

    const existingTx = db
      .prepare('SELECT date, amount FROM transactions')
      .all() as Array<{ date: string; amount: number }>;
    const existingKeys = new Set(
      existingTx.map((t) => `${t.date}|${Math.round(Math.abs(Number(t.amount) || 0))}`)
    );

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items = rawItems
      .map((it, idx) => {
        const rawAmt = Math.abs(Number(it.amount) || 0);
        if (!Number.isFinite(rawAmt) || rawAmt <= 0) return null;

        const targetSection = VALID_TARGET_SECTIONS.has(String(it.targetSection))
          ? (String(it.targetSection) as
              | 'cashflow'
              | 'current_asset'
              | 'current_liability'
              | 'longterm_asset'
              | 'longterm_liability'
              | 'holding')
          : 'cashflow';

        const date = normalizeIsoDate(it.date);
        const direction = String(it.direction).toLowerCase() === 'income' ? 'income' : 'expense';
        const activityRaw = String(it.activity || '').toLowerCase();
        const activity = VALID_ACTIVITIES.has(activityRaw)
          ? (activityRaw as 'operating' | 'investing' | 'financing')
          : 'operating';

        const catRaw = String(it.category || '').trim();
        const category = STATEMENT_CATEGORIES.has(catRaw)
          ? catRaw
          : direction === 'income'
            ? 'Other income'
            : 'Other';

        const balTypeRaw = String(it.balanceType || '').trim();
        const balanceType = VALID_BALANCE_TYPES.has(balTypeRaw) ? balTypeRaw : 'Other';
        const rawOriginalDesc = String(it.rawDescription || '').trim();
        const cleanedAiDesc = String(it.description || '')
          .replace(/\b(?:TXN|REF|FT|AUTH|TRACE)[:#\s-]*[A-Z0-9-]{4,}\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        const description = cleanedAiDesc || rawOriginalDesc || category;
        const originalDescription =
          rawOriginalDesc && rawOriginalDesc.toLowerCase() !== description.toLowerCase()
            ? rawOriginalDesc
            : undefined;

        const signedAmount =
          targetSection === 'cashflow'
            ? direction === 'expense'
              ? -rawAmt
              : rawAmt
            : rawAmt;

        const dupKey = `${date}|${Math.round(rawAmt)}`;
        const possibleDuplicate = targetSection === 'cashflow' && existingKeys.has(dupKey);

        const hKindRaw = String(it.holdingKind || '').trim();
        const holdingKind = VALID_HOLDING_KINDS.has(hKindRaw) ? hKindRaw : 'Stock';
        const holdingUnits = Math.max(0, Number(it.holdingUnits) || 0);
        const holdingCost = Math.max(0, Number(it.holdingCost) || 0);
        const holdingSymbol = String(it.holdingSymbol || '').trim();

        const confRaw = String(it.confidence || '').toLowerCase();
        const confidence =
          confRaw === 'high' || confRaw === 'medium' || confRaw === 'low' ? confRaw : 'medium';

        return {
          id: `stmt-${idx}-${crypto.randomBytes(3).toString('hex')}`,
          include: !possibleDuplicate,
          targetSection,
          date,
          activity,
          direction,
          category,
          balanceType,
          description,
          originalDescription,
          amount: signedAmount,
          holdingSymbol: holdingSymbol || undefined,
          holdingKind: targetSection === 'holding' ? holdingKind : undefined,
          holdingUnits: targetSection === 'holding' ? holdingUnits : undefined,
          holdingCost: targetSection === 'holding' ? holdingCost : undefined,
          holdingSource: targetSection === 'holding' ? 'Yahoo' : undefined,
          confidence,
          reason: typeof it.reason === 'string' ? it.reason.trim() : undefined,
          possibleDuplicate,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const closingAmt = Number(parsed.closingBalanceAmount);
    const closingBalance =
      Number.isFinite(closingAmt) && closingAmt > 0
        ? {
            amount: closingAmt,
            date: normalizeIsoDate(parsed.closingBalanceDate || parsed.statementTo),
          }
        : null;

    return res.json({
      bankDetected: (parsed.bankDetected || bankHint || 'Bank Statement').trim(),
      statementFrom: parsed.statementFrom ? normalizeIsoDate(parsed.statementFrom) : '',
      statementTo: parsed.statementTo ? normalizeIsoDate(parsed.statementTo) : '',
      closingBalance,
      summary: (parsed.summary || `Extracted ${items.length} entries from statement.`).trim(),
      items,
    });
  });

  app.post('/api/bank-statement/import', (req, res) => {
    const { db } = getRequestUserContext(req);
    if (!requireProPlan(db, res, 'AI Statement Import')) return;
    const { items, closingBalanceUpdate } = req.body ?? {};
    if (!Array.isArray(items) && !closingBalanceUpdate) {
      return res.status(400).json({ error: 'No statement items or balance update provided.' });
    }

    const list = Array.isArray(items) ? items : [];
    let txCount = 0;
    let balCount = 0;
    let holdCount = 0;

    try {
      db.exec('BEGIN');

      const insertTx = db.prepare(
        "INSERT INTO transactions (date, activity, category, description, amount, native_currency, receipt_id, receipt_name, receipt_mime) VALUES (?, ?, ?, ?, ?, 'TZS', '', '', '')"
      );
      const insertBal = db.prepare(
        "INSERT INTO balance (section, name, amount, date, type, native_currency) VALUES (?, ?, ?, ?, ?, 'TZS')"
      );
      const insertHold = db.prepare(
        "INSERT INTO holdings (symbol, kind, units, cost, price, updated, date, source, url, selector, regex, native_currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', '', 'TZS')"
      );

      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const targetSection = String(raw.targetSection || 'cashflow');
        if (!VALID_TARGET_SECTIONS.has(targetSection)) continue;

        const date = normalizeIsoDate(raw.date);
        const description = typeof raw.description === 'string' ? raw.description.trim() : '';
        const amount = Number(raw.amount);
        if (!Number.isFinite(amount) || amount === 0) continue;

        if (targetSection === 'cashflow') {
          const activity = VALID_ACTIVITIES.has(String(raw.activity))
            ? String(raw.activity)
            : 'operating';
          const category =
            typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : 'Other';
          const direction = raw.direction === 'income' ? 'income' : raw.direction === 'expense' ? 'expense' : amount < 0 ? 'expense' : 'income';
          const signed = direction === 'expense' ? -Math.abs(amount) : Math.abs(amount);
          insertTx.run(date, activity, category, description, signed);
          txCount += 1;
        } else if (targetSection === 'holding') {
          const sym =
            typeof raw.holdingSymbol === 'string' && raw.holdingSymbol.trim()
              ? raw.holdingSymbol.trim()
              : description.slice(0, 24) || 'Holding';
          const kind = VALID_HOLDING_KINDS.has(String(raw.holdingKind))
            ? String(raw.holdingKind)
            : 'Stock';
          const units = Math.max(0, Number(raw.holdingUnits) || 1);
          const cost =
            Number(raw.holdingCost) > 0
              ? Number(raw.holdingCost)
              : units > 0
                ? Math.abs(amount) / units
                : Math.abs(amount);
          const source = normalizeHoldingSource(raw.holdingSource || 'Yahoo', '');
          insertHold.run(sym, kind, units, cost, cost, nowStamp(), date, source);
          holdCount += 1;
        } else {
          // Balance sheet section
          const balType = VALID_BALANCE_TYPES.has(String(raw.balanceType))
            ? String(raw.balanceType)
            : 'Other';
          const name = description || balType;
          insertBal.run(targetSection, name, Math.abs(amount), date, balType);
          balCount += 1;
        }
      }

      if (closingBalanceUpdate && typeof closingBalanceUpdate === 'object') {
        const bankName = String(closingBalanceUpdate.bankName || '').trim();
        const balAmount = Number(closingBalanceUpdate.amount);
        const balDate = normalizeIsoDate(closingBalanceUpdate.date);
        if (bankName && Number.isFinite(balAmount) && balAmount >= 0) {
          const existingBank = db
            .prepare(
              "SELECT id FROM balance WHERE section = 'current_asset' AND type = 'Cash in bank' AND LOWER(name) = LOWER(?)"
            )
            .get(bankName) as { id: number } | undefined;
          if (existingBank) {
            db.prepare('UPDATE balance SET amount = ?, date = ? WHERE id = ?').run(
              balAmount,
              balDate,
              existingBank.id
            );
          } else {
            insertBal.run('current_asset', bankName, balAmount, balDate, 'Cash in bank');
          }
          balCount += 1;
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      return res.status(400).json({ error: (err as Error).message || 'Failed to import statement' });
    }

    return res.json({
      imported: { transactions: txCount, balance: balCount, holdings: holdCount },
      state: getFullState(db),
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distDir, {
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinanceDesk server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start FinanceDesk server:', err);
  process.exit(1);
});
