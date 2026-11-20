// ─────────────────────────────────────────────────────────────
// 用户表存储（演示环境）：localStorage 中的 `kmu:users:v1` 表，
// 结构与 server/schema.sql 的 users 表一一对应，接后端时按同一形状迁移。
//
// 安全说明：
//  · 密码永不明文存储——PBKDF2-SHA256（120k 次迭代）+ 16 字节随机盐，
//    存 password_hash（Base64）与 salt（Base64），用 timing-safe 比较校验；
//  · 用户名唯一（不区分大小写的 usernameLower 做唯一键）；
//  · 对外只暴露 safeUser（不含哈希与盐）。
// ─────────────────────────────────────────────────────────────

export const USER_DB_KEY = 'kmu:users:v1';
export const SESSION_KEY = 'kmu:session:v1';
export const DEMO_USER_ID = 'demo-001';
const DB_VERSION = 1;
const PBKDF2_ITERATIONS = 120000;

export const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;

const safeUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  status: u.status,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt ?? null,
});

function demoRow() {
  return {
    id: DEMO_USER_ID,
    username: 'demo',
    usernameLower: 'demo',
    displayName: '演示账号',
    role: 'demo',
    status: 'active',
    passwordHash: null,
    salt: null,
    iterations: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastLoginAt: null,
  };
}

function readDb() {
  let db = null;
  try {
    db = JSON.parse(localStorage.getItem(USER_DB_KEY) || 'null');
  } catch { /* 损坏数据重建 */ }
  if (!db || !Array.isArray(db.users)) db = { version: DB_VERSION, users: [] };
  if (!db.users.some((u) => u.id === DEMO_USER_ID)) db.users.unshift(demoRow());
  return db;
}

function writeDb(db) {
  try { localStorage.setItem(USER_DB_KEY, JSON.stringify(db)); } catch { /* 存储不可用忽略 */ }
}

/** 建表 + 演示账号种子（幂等） */
export function ensureUserTable() {
  const db = readDb();
  writeDb(db);
  return db;
}

export function getDemoUser() {
  const db = ensureUserTable();
  return safeUser(db.users.find((u) => u.id === DEMO_USER_ID));
}

export function listUsers() {
  return ensureUserTable().users.map(safeUser);
}

export function getUserById(id) {
  const u = ensureUserTable().users.find((x) => x.id === id);
  return u ? safeUser(u) : null;
}

// ── 密码学工具 ──────────────────────────────────────────────
function toBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

async function hashPassword(password, saltB64, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromBase64(saltB64), iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toBase64(new Uint8Array(bits));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function setSession(userId) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, at: new Date().toISOString() })); } catch { /* ignore */ }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** 最近一次登录的用户（用于登录页预填用户名；不做自动登录） */
export function getLastUser() {
  try {
    const sess = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!sess?.userId) return null;
    return getUserById(sess.userId);
  } catch {
    return null;
  }
}

// ── 注册 / 登录 ─────────────────────────────────────────────
/**
 * 注册新账号并写入用户表。
 * @returns {{ok:true,user:safeUser}|{ok:false,error:string}}
 */
export async function registerUser({ username, password, displayName }) {
  const name = String(username ?? '').trim();
  const pass = String(password ?? '');
  const nick = String(displayName ?? '').trim().slice(0, 16);
  if (!USERNAME_RE.test(name)) return { ok: false, error: '用户名需 3–20 位（字母 / 数字 / 下划线 / 中文）' };
  if (pass.length < 6) return { ok: false, error: '密码至少 6 位' };
  const lower = name.toLowerCase();
  const db = readDb();
  if (db.users.some((u) => u.usernameLower === lower)) return { ok: false, error: '用户名已存在，请换一个' };
  if (!crypto?.subtle) return { ok: false, error: '当前环境不支持安全密码存储（需要 HTTPS / localhost）' };

  const salt = randomSalt();
  const hash = await hashPassword(pass, salt, PBKDF2_ITERATIONS);
  const user = {
    id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    username: name,
    usernameLower: lower,
    displayName: nick || name,
    role: 'user',
    status: 'active',
    passwordHash: hash,
    salt,
    iterations: PBKDF2_ITERATIONS,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString(),
  };
  db.users.push(user);
  writeDb(db);
  setSession(user.id);
  return { ok: true, user: safeUser(user) };
}

/**
 * 登录校验。
 * @returns {{ok:true,user:safeUser}|{ok:false,error:string}}
 */
export async function loginUser({ username, password }) {
  const name = String(username ?? '').trim();
  const pass = String(password ?? '');
  if (!name || !pass) return { ok: false, error: '请输入用户名和密码' };
  const db = readDb();
  const user = db.users.find((u) => u.usernameLower === name.toLowerCase());
  if (!user || !user.passwordHash || !user.salt) return { ok: false, error: '账号或密码不正确' };
  if (user.status !== 'active') return { ok: false, error: '账号已停用，请联系管理员' };
  const hash = await hashPassword(pass, user.salt, user.iterations || PBKDF2_ITERATIONS);
  if (!timingSafeEqual(hash, user.passwordHash)) return { ok: false, error: '账号或密码不正确' };
  user.lastLoginAt = new Date().toISOString();
  writeDb(db);
  setSession(user.id);
  return { ok: true, user: safeUser(user) };
}
