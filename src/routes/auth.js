const express = require('express');
const { db } = require('../db');
const { now } = require('../utils/helpers');
const { hashPassword, verifyPassword, signJwt, generateSecret, verifyJwt } = require('../utils/auth');
const appConfig = require('../config');
const { requireAdmin } = require('../utils/api');

const loginAttempts = new Map();
const CHANNEL_PORTS = { shopify: '8080', amazon: '8082', management: '8081' };
const ALL_CHANNELS = ['shopify', 'amazon'];

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
  } else if (expectedChannel && user.channel !== expectedChannel) {
    return { ok: false, status: 403, error: '当前账号与访问端不匹配' };
  }

  return { ok: true, user };
}

function getAccessibleChannels(user) {
  if (!user) return [];
  return user.role === 'admin' ? ALL_CHANNELS.slice() : ALL_CHANNELS.filter((channel) => channel === user.channel);
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
  const expectedChannel = mode === 'management' ? 'management' : mode;

  router.post('/verify', (req, res) => {
    try {
      const requestedChannel = mode === 'management' ? (req.body?.channel || null) : expectedChannel;
      const auth = loadCurrentUser(req, { expectedChannel: requestedChannel });
      if (!auth.ok) return res.json({ ok: false });
      res.json({ ok: true, user: formatUser(auth.user) });
    } catch {
      res.json({ ok: false });
    }
  });

  router.get('/channels', (req, res) => {
    try {
      const auth = loadCurrentUser(req, { expectedChannel: mode === 'management' ? null : expectedChannel });
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
      const auth = loadCurrentUser(req, { expectedChannel });
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
      const auth = loadCurrentUser(req, { expectedChannel });
      if (!auth.ok) {
        return res.status(auth.status || 401).json({ ok: false, error: auth.error || '未登录' });
      }
      const displayName = String(req.body?.display_name || '').trim();
      if (!displayName) {
        return res.status(400).json({ ok: false, error: '显示名不能为空' });
      }
      db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?').run(displayName, now(), auth.user.id);
      const updated = getUserById(auth.user.id);
      res.json({ ok: true, user: formatUser(updated) });
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
      const auth = loadCurrentUser(req, { expectedChannel });
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

function managementAuthRoutes() {
  const router = express.Router();

  router.post('/login', loginRateLimit, (req, res) => {
    try {
      const { channel, username, password } = req.body || {};
      if (!channel || !username || !password) {
        return res.status(400).json({ ok: false, error: '请选择渠道并输入用户名和密码' });
      }
      if (!['shopify', 'amazon'].includes(channel)) {
        return res.status(400).json({ ok: false, error: '渠道必须是 shopify 或 amazon' });
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
        rows = db.prepare('SELECT id,channel,username,display_name,role,enabled,created_at,updated_at FROM users ORDER BY channel,id').all();
      }
      res.json(rows);
    } catch (e) {
      console.error('[AUTH] list users error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.post('/users', requireAdmin, (req, res) => {
    try {
      const { channel, username, password, display_name, role } = req.body || {};
      if (!channel || !username || !password) {
        return res.status(400).json({ ok: false, error: '渠道、用户名和密码必填' });
      }
      if (password.length < 6) {
        return res.status(400).json({ ok: false, error: '密码长度不能少于 6 个字符' });
      }
      const allowedRoles = ['admin', 'operator'];
      if (role && !allowedRoles.includes(role)) {
        return res.status(400).json({ ok: false, error: '角色必须是 admin 或 operator' });
      }
      if (!['shopify', 'amazon'].includes(channel)) {
        return res.status(400).json({ ok: false, error: '渠道必须是 shopify 或 amazon' });
      }
      const existing = db.prepare('SELECT id FROM users WHERE channel = ? AND username = ?').get(channel, username);
      if (existing) {
        return res.status(400).json({ ok: false, error: '该渠道下已存在此用户名' });
      }
      const { hash, salt } = hashPassword(password);
      const ts = now();
      const result = db.prepare('INSERT INTO users(channel,username,password_hash,salt,display_name,role,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(channel, username, hash, salt, display_name || username, role || 'operator', 1, ts, ts);
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) {
      console.error('[AUTH] create user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.put('/users/:id', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const { username, display_name, role, enabled, password } = req.body || {};
      const user = db.prepare('SELECT id,username,display_name FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
      if (password && password.length < 6) {
        return res.status(400).json({ ok: false, error: '密码长度不能少于 6 个字符' });
      }
      const allowedRoles = ['admin', 'operator'];
      if (role && !allowedRoles.includes(role)) {
        return res.status(400).json({ ok: false, error: '角色必须是 admin 或 operator' });
      }
      if (username && username !== user.username) {
        const dup = db.prepare('SELECT id FROM users WHERE channel = (SELECT channel FROM users WHERE id = ?) AND username = ? AND id != ?').get(id, username, id);
        if (dup) return res.status(400).json({ ok: false, error: '该渠道下已存在此用户名' });
      }
      const ts = now();
      if (password) {
        const { hash, salt } = hashPassword(password);
        db.prepare('UPDATE users SET username=?,display_name=?,role=?,enabled=?,password_hash=?,salt=?,updated_at=? WHERE id=?')
          .run(username || user.username, display_name || username || user.display_name, role, enabled ?? 1, hash, salt, ts, id);
      } else {
        db.prepare('UPDATE users SET username=?,display_name=?,role=?,enabled=?,updated_at=? WHERE id=?')
          .run(username || user.username, display_name || username || user.display_name, role, enabled ?? 1, ts, id);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('[AUTH] update user error:', e);
      res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  router.delete('/users/:id', requireAdmin, (req, res) => {
    try {
      const { id } = req.params;
      const user = db.prepare('SELECT id,username,role FROM users WHERE id = ?').get(id);
      if (!user) return res.status(404).json({ ok: false, error: '用户不存在' });
      if (user.role === 'admin') {
        return res.status(400).json({ ok: false, error: '不能删除管理员账号' });
      }
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
      res.json({ ok: true });
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

module.exports = { authRoutes, managementAuthRoutes, userRoutes };
