/**
 * Auth Microservice — extracted from monolith server.cjs
 * Handles: login, signup, logout, password reset, 2FA, KYC gate, token refresh
 * 
 * Runs independently on port 5010
 * Communicates with main service via HTTP or can be proxied through APISIX
 */
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.AUTH_PORT || 5010;

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'ngapp',
  user: process.env.PGUSER || 'ngapp',
  password: process.env.PGPASSWORD || 'ngapp',
  max: 10,
});

const emailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailgun.org',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' },
});

function signAccessToken(payload) {
  return jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY, issuer: 'insureportal', subject: String(payload.id) });
}
function signRefreshToken(payload) {
  return jwt.sign({ sub: payload.id, type: 'refresh' }, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRY, issuer: 'insureportal' });
}
function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET, { issuer: 'insureportal' }); } catch (e) { return null; }
}

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
async function q1(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

// TOTP computation
function computeTOTP(secret) {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase()) {
    const val = base32Chars.indexOf(c);
    if (val >= 0) bits += val.toString(2).padStart(5, '0');
  }
  const keyBytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < keyBytes.length; i++) keyBytes[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
  function gen(counter) {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const hmac = crypto.createHmac('sha1', keyBytes).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
    return String(code).padStart(6, '0');
  }
  const counter = Math.floor(Date.now() / 30000);
  return { current: gen(counter), previous: gen(counter - 1) };
}

async function checkKycGate(userId) {
  const kyc = await q1('SELECT "kycLevel", "kycStatus" FROM kyc_profiles WHERE "userId"=$1', [userId]);
  const level = kyc?.kycLevel || 0;
  return {
    level,
    passed: level >= 2,
    kycStatus: kyc?.kycStatus || 'pending',
    remainingSteps: level < 3 ? ['bvn', 'nin', 'phone', 'address', 'id_document', 'facial_match'].slice(level) : [],
    blockedFeatures: level < 2 ? ['claims', 'payments', 'marketplace'] : [],
  };
}

// Health
app.get('/health', (req, res) => res.json({ service: 'auth', status: 'healthy' }));

// Login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await q1('SELECT id, email, name, role, "displayName", "passwordHash", "totpEnabled" FROM users WHERE email=$1', [email]);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.passwordHash || !user.passwordHash.startsWith('$2')) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.totpEnabled) return res.json({ requires2FA: true, email: user.email });
    const kycCheck = await checkKycGate(user.id);
    const accessToken = signAccessToken({ id: user.id, email: user.email, role: user.role, kycLevel: kycCheck.level });
    const refreshToken = signRefreshToken({ id: user.id });
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, token: accessToken, refreshToken, kycLevel: kycCheck.level, requiresKyc: !kycCheck.passed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Signup
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, fullName, phone } = req.body;
    if (!email || !password || !fullName) return res.status(400).json({ error: 'Email, password, and full name required' });
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) return res.status(400).json({ error: 'Password must be 8+ chars with uppercase and number' });
    const existing = await q1('SELECT id FROM users WHERE email=$1', [email]);
    if (existing) return res.status(409).json({ error: 'Account exists' });
    const hash = await bcrypt.hash(password, 12);
    const newUser = await q1(`INSERT INTO users (email, name, "displayName", phone, role, "passwordHash", "createdAt", "updatedAt", "lastSignedIn") VALUES ($1, $2, $2, $3, 'user', $4, NOW(), NOW(), NOW()) RETURNING id, email, name, role`, [email, fullName, phone, hash]);
    await q1(`INSERT INTO kyc_profiles ("userId", "kycLevel", "kycStatus", "riskRating", "createdAt", "updatedAt") VALUES ($1, 0, 'pending', 'unknown', NOW(), NOW())`, [newUser.id]);
    const accessToken = signAccessToken({ id: newUser.id, email, role: 'user', kycLevel: 0 });
    const refreshToken = signRefreshToken({ id: newUser.id });
    res.status(201).json({ ...newUser, token: accessToken, refreshToken, kycLevel: 0, requiresKyc: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Token refresh
app.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const payload = verifyToken(refreshToken);
    if (!payload || payload.type !== 'refresh') return res.status(401).json({ error: 'Invalid refresh token' });
    const user = await q1('SELECT id, email, name, role FROM users WHERE id=$1', [payload.sub]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    const kycCheck = await checkKycGate(user.id);
    const newToken = signAccessToken({ id: user.id, email: user.email, role: user.role, kycLevel: kycCheck.level });
    res.json({ token: newToken, ...user, kycLevel: kycCheck.level });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Verify token (for other services)
app.get('/auth/verify', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ valid: false });
  res.json({ valid: true, userId: decoded.sub, role: decoded.role, email: decoded.email });
});

// Password reset
app.post('/auth/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await q1('SELECT id, email, name, phone FROM users WHERE email=$1', [email]);
    if (!user) return res.json({ success: true, message: 'If an account exists, a reset code has been sent.' });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await q(`INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET token=$2, expires_at=$3`, [user.id, otp, new Date(Date.now() + 900000)]);
    if (process.env.SMTP_USER) {
      emailTransport.sendMail({ from: 'InsurePortal <noreply@insureportal.ng>', to: email, subject: 'Password Reset', html: `<p>Your OTP: <strong>${otp}</strong>. Expires in 15 min.</p>` });
    }
    res.json({ success: true, message: 'If an account exists, a reset code has been sent.', _demo_otp: otp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2FA setup/verify
app.post('/auth/setup-2fa', async (req, res) => {
  const { userId } = req.body;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let secret = '';
  for (let i = 0; i < 32; i++) secret += chars[Math.floor(Math.random() * chars.length)];
  await q(`UPDATE users SET "totpSecret"=$1, "totpEnabled"=false WHERE id=$2`, [secret, userId]);
  res.json({ secret, otpauthUrl: `otpauth://totp/InsurePortal:${userId}?secret=${secret}&issuer=InsurePortal` });
});

app.post('/auth/verify-2fa', async (req, res) => {
  const { userId, code } = req.body;
  const user = await q1('SELECT "totpSecret" FROM users WHERE id=$1', [userId]);
  if (!user?.totpSecret) return res.status(400).json({ error: '2FA not set up' });
  const totp = computeTOTP(user.totpSecret);
  if (code !== totp.current && code !== totp.previous) return res.status(401).json({ error: 'Invalid code' });
  await q('UPDATE users SET "totpEnabled"=true WHERE id=$1', [userId]);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Auth service running on port ${PORT}`));
