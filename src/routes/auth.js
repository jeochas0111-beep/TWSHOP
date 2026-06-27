const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/helpers');
const { hashPassword, verifyPassword, signJwt, generateSecret, verifyJwt } = require('../utils/auth');
const appConfig = require('../config');
const { requireAdmin } = require('../utils/api');

const loginAttempts = new Map();
const CHANNEL_PORTS = { shopify: '8080', amazon: '8082', management: '8081', production: '8083' };
const CHANNEL_PATHS = { shopify: '/ops/shopify', amazon: '/ops/amazon', management: '/admin', production: '/production' };
const ALL_CHANNELS = ['shopify', 'amazon'];
const FIXED_SYSTEM_USERS = new Set(['admin', 'twshop', 'twama', 'twprod']);

function loginRateLimit(req, res, next) {
  const key = req.ip || req.socket?.remoteAddress || 'local';
  const nowMs = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 20;
  // Periodically clean expired entries to prevent memory leak
  if (loginAttempts.size > 100) {
    for (const [k, v] of loginAttempts) {
      if (v.resetAt <= nowMs) loginAttempts.delete(k);
    }
  }
  const current = loginAttempts.get(key) || { count: 0, resetAt: nowMs + windowMs };
  if (current.resetAt <= nowMs) {
    current.count = 0;
    current.resetAt = nowMs + windowMs;
  }
  current.count += 1;
  loginAttempts.set(key, current);
  if (current.count > maxAttempts) {
    return res.status(429).json({ ok: false, error: '登录尝试过多，请稍后再试' });
  }
  next();
}

function formatUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name || user.username,
    role: user.role,
    channel: user.channel
  };
}

function localUser(channel = null) {
  return {
    id: 0,
    username: 'local',
    display_name: '本地用户',
    role: 'admin',
    channel
  };
}

function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return req.body?.token || req.query?.token || '';
}

function getUserById(id) {
  return db.prepare('SELECT id,channel,username,display_name,role,enabled,password_hash,salt,created_at,updated_at FROM users WHERE id = ?').get(id);
}

function loadCurrentUser(req, options = {}) {
  const cfg = appConfig.authConfig();
  const { expectedChannel = null } = options;

  if (cfg.noAuth) {
    if (expectedChannel === 'management') return { ok: true, user: localUser(null) };
    return { ok: true, user: localUser(expectedChannel || null) };
  }

  const token = extractToken(req);
  if (!token) {
    return { ok: false, status: 401, error: '未登录' };
  }

  const payload = verifyJwt(token, generateSecret());
  if (!payload?.sub) {
    return { ok: false, status: 401, error: '登录已过期' };
  }

  const user = getUserById(payload.sub);
  if (!user || Number(user.enabled) === 0) {
    return { ok: false, status: 401, error: '账号不可用' };
  }

  if (expectedChannel === 'management') {
    if (user.role !== 'admin') {
      return { ok: false, status: 403, error: '当前账号不能访问管理端' };
    }
  } else if (expectedChannel && user.channel !== expectedChannel && user.role !== 'admin') {
    return { ok: false, status: 403, error: '当前账号与访问端不匹配' };
  }

  return { ok: true, user };
}

function getAccessibleChannels(user) {
  if (!user) return [];
  return user.role === 'admin' ? ALL_CHANNELS.slice() : ALL_CHANNELS.filter((channel) => channel === user.channel);
}

function defaultAppPathForUser(user) {
  if (!user) return '/login';
  if (user.role === 'admin') return CHANNEL_PATHS.management;
  return CHANNEL_PATHS[user.channel] || CHANNEL_PATHS.shopify;
}

function authScope(mode, req) {
  if (mode === 'management') return 'management';
  if (mode === 'unified') {
    const headerApp = String(req.headers['x-twodrapes-app'] || '').trim();
    if (headerApp === 'management') return 'management';
    if (headerApp === 'amazon') return 'amazon';
    if (headerApp === 'shopify') return 'shopify';
    const requestedChannel = String(req.body?.channel || req.query?.channel || '').trim();
    if (requestedChannel === 'amazon' || requestedChannel === 'shopify') return requestedChannel;
    return null;
  }
  return mode || null;
}

function findLoginMatch(username, password) {
  const rows = db.prepare('SELECT * FROM users WHERE username = ? AND enabled = 1 ORDER BY CASE WHEN role = ? THEN 0 ELSE 1 END, channel, id').all(username, 'admin');
  const matches = rows.filter((user) => verifyPassword(password, user.password_hash, user.salt));
  if (!matches.length) return { ok: false, status: 401, error: '用户名或密码错误' };
  if (matches.length === 1) return { ok: true, user: matches[0] };

  const adminMatches = matches.filter((user) => user.role === 'admin');
  if (adminMatches.length === 1) return { ok: true, user: adminMatches[0] };

  return { ok: false, status: 409, error: '该用户名对应多个账号，请联系管理员处理' };
}

function issueToken(user) {
  const cfg = appConfig.authConfig();
  return signJwt(
    {
      sub: user.id,
      username: user.username,
      channel: user.channel,
      role: user.role,
      display_name: user.display_name || user.username
    },
    generateSecret(),
    cfg.jwtExpiresIn
  );
}

function attachCommonAuthRoutes(router, mode) {
  const fixedExpectedChannel = mode === 'management' ? 'management' : mode;

  router.post('/verify', (req, res) => {
    try {
      const requestedChannel = mode === 'unified'
        ? authScope(mode, req)
        : (mode === 'management' ? (req.body?.channel || 'management') : fixedExpectedChannel);
      const auth = loadCurrentUser(req, { expectedChannel: requestedChannel });
      if (!auth.ok) {
        const fallback = loadCurrentUser(req, { expectedChannel: null });
        const redirectPath = fallback.ok ? defaultAppPathForUser(fallback.user) : null;
        return res.status(auth.status || 401).json({ ok: false, redirectPath });
      }
      res.json({ ok: true, user: formatUser(auth.user) });
    } catch {
      res.json({ ok: false });
    }
  });

  router.get('/channels', (req, res) => {
    try {
      const auth = loadCurrentUser(req, {
        expectedChannel: mode === 'unified'
          ? authScope(mode, req)
          : (mode === 'management' ? null : fixedExpectedChannel)
      });
      if (!auth.ok) {
        return res.status(auth.status || 401).json({ ok: false, error: auth.error || '未登录' });
      }
      const channels = getAccessibleChannels(auth.user);
      res.json({ ok: true, channels, channelPorts: CHANNEL_PORTS });
    } catch (e) {
      console.error('[AUTH] channels error:', e);
      res.status(500).json({ ok: false, error: '服务器错误' });
    }
  });

  router.get('/me', (req, res) => {
    try {
      const auth = loadCurrentUser(req, {
        expectedChannel: mode === 'unified' ? authScope(mode, req) : fixedExpectedChannel
      });
      if (!auth.ok) {
        return res.status(auth.status || 401).json({ ok: false, error: auth.error || '未登录' });
      }
      res.json({ ok: true, user: formatUser(auth.user) });
    } catch (e) {
      console.error('[AUTH] me error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.put('/me', (req, res) => {
    try {
      if (appConfig.authConfig().noAuth) {
        return res.status(400).json({ ok: false, error: '免登录模式下不可修改个人信息' });
      }
      const auth = loadCurrentUser(req, {
        expectedChannel: mode === 'unified' ? authScope(mode, req) : fixedExpectedChannel
      });
      if (!auth.ok) {
        return res.status(auth.status || 401).json({ ok: false, error: auth.error || '未登录' });
      }
      const displayName = String(req.body?.display_name || '').trim();
      if (!displayName) {
        return res.status(400).json({ ok: false, error: '显示名不能为空' });
      }
      const newUsername = String(req.body?.username || '').trim();
      let token = null;
      if (newUsername && newUsername !== auth.user.username) {
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(newUsername)) {
          return res.status(400).json({ ok: false, error: '用户名须为 3-20 位字母、数字或下划线' });
        }
        const conflict = db.prepare('SELECT id FROM users WHERE channel = ? AND username = ? AND id != ?').get(auth.user.channel, newUsername, auth.user.id);
        if (conflict) {
          return res.status(400).json({ ok: false, error: '该用户名已被使用' });
        }
        db.prepare('UPDATE users SET username = ?, display_name = ?, updated_at = ? WHERE id = ?').run(newUsername, displayName, now(), auth.user.id);
        const updated = getUserById(auth.user.id);
        token = issueToken(updated);
        res.json({ ok: true, user: formatUser(updated), token });
      } else {
        db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(displayName, now(), auth.user.id);
        const updated = getUserById(auth.user.id);
        res.json({ ok: true, user: formatUser(updated) });
      }
    } catch (e) {
      console.error('[AUTH] update me error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/change-password', (req, res) => {
    try {
      if (appConfig.authConfig().noAuth) {
        return res.status(400).json({ ok: false, error: '免登录模式下不可修改密码' });
      }
      const auth = loadCurrentUser(req, {
        expectedChannel: mode === 'unified' ? authScope(mode, req) : fixedExpectedChannel
      });
      if (!auth.ok) {
        return res.status(auth.status || 401).json({ ok: false, error: auth.error || '未登录' });
      }
      const currentPassword = String(req.body?.currentPassword || '');
      const newPassword = String(req.body?.newPassword || '');
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ ok: false, error: '请输入当前密码和新密码' });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ ok: false, error: '密码长度不能少于 6 个字符' });
      }
      if (!verifyPassword(currentPassword, auth.user.password_hash, auth.user.salt)) {
        return res.status(400).json({ ok: false, error: '当前密码不正确' });
      }
      const { hash, salt } = hashPassword(newPassword);
      db.prepare('UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?').run(hash, salt, now(), auth.user.id);
      res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] change password error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });
}

function authRoutes(channel) {
  const router = express.Router();

  router.post('/login', loginRateLimit, (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
      }
      const user = db.prepare('SELECT * FROM users WHERE channel = ? AND username = ? AND enabled = 1').get(channel, username);
      if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
        return res.status(401).json({ ok: false, error: '用户名或密码错误' });
      }
      const token = issueToken(user);
      res.json({ ok: true, token, user: formatUser(user) });
    } catch (e) {
      console.error('[AUTH] login error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  attachCommonAuthRoutes(router, channel);

  return router;
}

function unifiedAuthRoutes() {
  const router = express.Router();

  router.post('/login', loginRateLimit, (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ ok: false, error: '请输入用户名和密码' });
      }
      const match = findLoginMatch(username, password);
      if (!match.ok) {
        return res.status(match.status || 401).json({ ok: false, error: match.error });
      }
      const token = issueToken(match.user);
      res.json({ ok: true, token, user: formatUser(match.user), redirectPath: defaultAppPathForUser(match.user) });
    } catch (e) {
      console.error('[AUTH] unified login error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  attachCommonAuthRoutes(router, 'unified');

  return router;
}

function managementAuthRoutes() {
  const router = express.Router();

  router.post('/login', loginRateLimit, (req, res) => {
    try {
      const { channel, username, password } = req.body || {};
      if (!channel || !username || !password) {
        return res.status(400).json({ ok: false, error: '请选择渠道并输入用户名和密码' });
      }
      if (!['shopify', 'amazon', 'production'].includes(channel)) {
        return res.status(400).json({ ok: false, error: '渠道必须是 shopify、amazon 或 production' });
      }
      const user = db.prepare('SELECT * FROM users WHERE channel = ? AND username = ? AND enabled = 1').get(channel, username);
      if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
        return res.status(401).json({ ok: false, error: '用户名或密码错误' });
      }
      const token = issueToken(user);
      res.json({ ok: true, token, user: formatUser(user) });
    } catch (e) {
      console.error('[AUTH] management login error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  attachCommonAuthRoutes(router, 'management');

  return router;
}

function userRoutes() {
  const router = express.Router();

  router.get('/users', requireAdmin, (req, res) => {
    try {
      const { channel } = req.query;
      let rows;
      if (channel) {
        rows = db.prepare('SELECT id,channel,username,display_name,role,enabled,created_at,updated_at FROM users WHERE channel = ? ORDER BY id').all(channel);
      } else {
        rows = db.prepare(`
          SELECT id,channel,username,display_name,role,enabled,created_at,updated_at
          FROM users
          ORDER BY
            CASE channel
              WHEN 'management' THEN 0
              WHEN 'shopify' THEN 1
              WHEN 'amazon' THEN 2
              WHEN 'production' THEN 3
              ELSE 9
            END,
            id
        `).all();
      }
      res.json(rows);
    } catch (e) {
      console.error('[AUTH] list users error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/users', requireAdmin, (req, res) => {
    try {
      return res.status(403).json({ ok: false, error: '当前版本仅保留固定系统账户，不支持新增账号' });
    } catch (e) {
      console.error('[AUTH] create user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.put('/users/:id', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const { username, display_name, role, enabled, password } = req.body || {};
      const user = db.prepare('SELECT id,channel,username,display_name,role,enabled FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
      if (!FIXED_SYSTEM_USERS.has(user.username)) {
        return res.status(400).json({ ok: false, error: '当前版本仅允许维护固定系统账户' });
      }
      if (username && username !== user.username) {
        return res.status(400).json({ ok: false, error: '固定系统账户不支持修改用户名' });
      }
      if (role && role !== user.role) {
        return res.status(400).json({ ok: false, error: '固定系统账户不支持修改角色' });
      }
      if (password && password.length < 6) {
        return res.status(400).json({ ok: false, error: '密码长度不能少于 6 个字符' });
      }
      const ts = now();
      if (password) {
        const { hash, salt } = hashPassword(password);
        db.prepare('UPDATE users SET display_name=?,enabled=?,password_hash=?,salt=?,updated_at=? WHERE id=?')
          .run(display_name || user.display_name || user.username, enabled ?? user.enabled ?? 1, hash, salt, ts, id);
      } else {
        db.prepare('UPDATE users SET display_name=?,enabled=?,updated_at=? WHERE id=?')
          .run(display_name || user.display_name || user.username, enabled ?? user.enabled ?? 1, ts, id);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] update user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.delete('/users/:id', requireAdmin, (req, res) => {
    try {
      return res.status(403).json({ ok: false, error: '当前版本仅保留固定系统账户，不支持删除账号' });
    } catch (e) {
      console.error('[AUTH] delete user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/users/:id/reset-password', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body || {};
      if (!password) return res.status(400).json({ ok: false, error: '请输入新密码' });
      if (password.length < 6) {
        return res.status(400).json({ ok: false, error: '密码长度不能少于 6 个字符' });
      }
      const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
      const { hash, salt } = hashPassword(password);
      db.prepare('UPDATE users SET password_hash=?,salt=?,updated_at=? WHERE id=?').run(hash, salt, now(), id);
      res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] reset password error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  return router;
}

module.exports = { authRoutes, managementAuthRoutes, unifiedAuthRoutes, userRoutes, CHANNEL_PATHS };
