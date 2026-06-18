const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const appConfig = require('../config');

let _secret = null;

function generateSecret() {
  if (_secret) return _secret;
  const cfg = appConfig.authConfig();
  if (cfg.jwtSecret) {
    _secret = cfg.jwtSecret;
    return _secret;
  }
  const secretPath = path.join(__dirname, '..', '..', 'data', '.jwt-secret');
  try {
    if (fs.existsSync(secretPath)) {
      _secret = fs.readFileSync(secretPath, 'utf8').trim();
      if (_secret) return _secret;
    }
    _secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, _secret, { mode: 0o600 });
  } catch {
    _secret = crypto.randomBytes(32).toString('hex');
  }
  return _secret;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

function verifyPassword(password, storedHash, storedSalt) {
  try {
    const hash = crypto.scryptSync(String(password), Buffer.from(storedSalt, 'hex'), 64);
    const stored = Buffer.from(storedHash, 'hex');
    if (hash.length !== stored.length) return false;
    return crypto.timingSafeEqual(hash, stored);
  } catch {
    return false;
  }
}

function base64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signJwt(payload, secret, expiresInSec) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const headerPayload = `${base64url(header)}.${base64url(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(headerPayload).digest('base64url');
  return `${headerPayload}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest('base64url');
  const sigBuf = Buffer.from(sigB64, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function jwtAuth(channel) {
  return (req, res, next) => {
    const cfg = appConfig.authConfig();
    if (cfg.noAuth) {
      req.user = { channel: null, username: 'local', role: 'admin', auth: 'disabled' };
      return next();
    }
    if (req.path === '/api/auth/login' || req.path === '/api/auth/verify') return next();
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Basic ')) {
      const creds = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const [user, pass] = creds.split(':');
      if (user === cfg.adminUser && pass === cfg.adminPassword) {
        req.user = { channel, username: user, role: channel == null ? 'admin' : 'operator', auth: 'basic' };
        return next();
      }
    }
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, error: '未授权' });
    }
    const token = auth.slice(7);
    const payload = verifyJwt(token, generateSecret());
    if (!payload || (channel != null && payload.channel !== channel)) {
      return res.status(401).json({ ok: false, error: 'token 无效或已过期' });
    }
    req.user = payload;
    next();
  };
}

module.exports = { generateSecret, hashPassword, verifyPassword, signJwt, verifyJwt, jwtAuth };
