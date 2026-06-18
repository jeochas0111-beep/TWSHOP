const appConfig = require('../config');

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function badRequest(message) {
  throw new ApiError(400, message);
}

function notFound(message) {
  throw new ApiError(404, message);
}

function sendOk(res, payload = {}) {
  res.json({ ok: true, ...payload });
}

function sendError(res, status, message) {
  res.status(status).json({ ok: false, error: message });
}

function route(handler, fallbackStatus = 500) {
  return (req, res, next) => {
    try {
      return handler(req, res, next);
    } catch (error) {
      if (res.headersSent) return next(error);
      const status = error instanceof ApiError ? error.status : fallbackStatus;
      return sendError(res, status, error.message || '请求处理失败');
    }
  };
}

function requireAdmin(req, res, next) {
  if (appConfig.authConfig().noAuth) return next();
  if (req.user?.role === 'admin') return next();
  return sendError(res, 403, '需要管理员权限');
}

function requireFile(req, message = '请选择文件') {
  if (!req.file) badRequest(message);
  return req.file;
}

function positiveIntParam(req, name = 'id', message = '记录不存在') {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value <= 0) notFound(message);
  return value;
}

function nonNegativeNumber(value, message) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) badRequest(message);
  return n;
}

function positiveNumber(value, message) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) badRequest(message);
  return n;
}

function requiredText(value, message) {
  const text = String(value || '').trim();
  if (!text) badRequest(message);
  return text;
}

module.exports = {
  ApiError,
  badRequest,
  notFound,
  sendOk,
  sendError,
  requireAdmin,
  route,
  requireFile,
  positiveIntParam,
  nonNegativeNumber,
  positiveNumber,
  requiredText
};
