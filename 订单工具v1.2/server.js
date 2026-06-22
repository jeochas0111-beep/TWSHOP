require('dotenv').config();
const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { db, initDb, seedIfEmpty, dataDir, backupDir, exportDir } = require('./src/db');
const { context } = require('./src/utils/helpers');
const appConfig = require('./src/config');

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
});

// 路由模块
const healthRoutes = require('./src/routes/health');
const globalsRoutes = require('./src/routes/globals');
const materialsRoutes = require('./src/routes/materials');
const productsRoutes = require('./src/routes/products');
const rulesRoutes = require('./src/routes/rules');
const calcRoutes = require('./src/routes/calc');
const ordersRoutes = require('./src/routes/orders');
const importExportRoutes = require('./src/routes/import-export');
const factoryRoutes = require('./src/routes/factory');
const analyticsRoutes = require('./src/routes/analytics');
const backupsRoutes = require('./src/routes/backups');
const shopifyRoutes = require('./src/routes/shopify');
const { sampleRoutes } = require('./src/routes/samples');
const productionPhotosRoutes = require('./src/routes/production-photos');
const { authRoutes, managementAuthRoutes, unifiedAuthRoutes, userRoutes, CHANNEL_PATHS } = require('./src/routes/auth');
const { jwtAuth } = require('./src/utils/auth');

const serverCfg = appConfig.serverConfig();
const { port: PORT, factoryPort: FACTORY_PORT, amazonPort: AMAZON_PORT, productionPort: PRODUCTION_PORT } = serverCfg;
const HOST = serverCfg.host;

function shouldStartAuxiliaryServers() {
  if (process.env.MULTI_PORT === '1' || process.env.MULTI_PORT === 'true') return true;
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

// 中间件
function requestLog(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl || req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
}

const ALLOWED_PORTS = [PORT, FACTORY_PORT, AMAZON_PORT];
const CORS_ORIGIN_RE = new RegExp(`^https?://localhost(?::(?:${ALLOWED_PORTS.join('|')}))?$`);
const publicDir = path.join(__dirname, 'public');
const factoryDir = path.join(__dirname, 'public-factory');

function portalOrigin(req) {
  if (process.env.NODE_ENV === 'production') {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'https';
    const host = forwardedHost || req.get('host') || req.hostname;
    return host ? `${protocol}://${host}` : '';
  }
  return `${req.protocol}://${req.hostname}:${PORT}`;
}

function sendPortalRedirect(res, location) {
  res.redirect(302, location);
}

function transformedHtml(filePath, contextOverrides, req) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const assetBasePath = contextOverrides.assetBasePath || '';
  const contextScript = `<script>window.__TWODRAPES_CONTEXT__=${JSON.stringify({
    ...contextOverrides,
    portalOrigin: portalOrigin(req),
    publicPort: String(PORT),
    loginPath: '/login'
  })};</script>`;
  const withAssets = raw.replace(/(href|src)="\/(css|js)\//g, `$1="${assetBasePath}/$2/`);
  return withAssets.replace(/<script src="[^"]*channel-theme\.js"><\/script>/, `${contextScript}\n  <script src="${assetBasePath}/js/channel-theme.js"></script>`);
}

function sendHtmlPage(res, filePath, contextOverrides, req) {
  res.type('html').send(transformedHtml(filePath, contextOverrides, req));
}

function isAssetRequest(req) {
  return Boolean(path.extname(req.path || ''));
}

function resolvePortalAppContext(req, res, next) {
  const appName = String(req.headers['x-twodrapes-app'] || '').trim();
  if (appName === 'management') {
    req.channel = 'management';
  } else if (appName === 'amazon') {
    req.channel = 'amazon';
  } else {
    req.channel = 'shopify';
  }
  next();
}

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Twodrapes-App, X-Twodrapes-Channel');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
}

function errorHandler(err, req, res, next) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ ok: false, error: '文件大小超过限制（最大 10MB）' });
  }
  console.error(`[ERROR] ${req.method} ${req.originalUrl || req.url}`, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
}

// 创建应用
const app = express();
const factoryApp = express();
const amazonApp = express();
const productionApp = express();

// 初始化数据库
for (const dir of [dataDir, backupDir, exportDir, path.join(dataDir, 'production-photos')]) fs.mkdirSync(dir, { recursive: true });
initDb();
seedIfEmpty();

// 运营端（独立站）中间件
app.use(cors);
app.use(requestLog);
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/login-static', express.static(publicDir, { maxAge: '1h', etag: true, index: false }));
app.use('/ops/shopify', express.static(publicDir, { maxAge: '1h', etag: true, index: false }));
app.use('/ops/amazon', express.static(publicDir, { maxAge: '1h', etag: true, index: false }));
app.use('/admin', express.static(factoryDir, { maxAge: '1h', etag: true, index: false }));
app.use('/admin', express.static(publicDir, { maxAge: '1h', etag: true, index: false }));
const productionDir = path.join(__dirname, 'public-production');
app.use('/production', express.static(productionDir, { maxAge: '1h', etag: true, index: false }));

// 管理端中间件
factoryApp.use(cors);
factoryApp.use(requestLog);
factoryApp.use(compression());
factoryApp.use(express.json({ limit: '20mb' }));
factoryApp.use(express.urlencoded({ extended: true }));
factoryApp.use((req, res, next) => { req.channel = 'management'; next(); });
factoryApp.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/login.html') {
    return sendPortalRedirect(res, `${portalOrigin(req)}/login`);
  }
  next();
});
factoryApp.use(express.static(factoryDir, { maxAge: '1h', etag: true }));
factoryApp.use(express.static(publicDir, { maxAge: '1h', etag: true }));
factoryApp.use('/production', express.static(productionDir, { maxAge: '1h', etag: true }));

// 亚马逊端中间件（共用 public/ 前端）
amazonApp.use(cors);
amazonApp.use(requestLog);
amazonApp.use(compression());
amazonApp.use(express.json({ limit: '20mb' }));
amazonApp.use(express.urlencoded({ extended: true }));
amazonApp.use((req, res, next) => { req.channel = 'amazon'; next(); });
amazonApp.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/login.html') {
    return sendPortalRedirect(res, `${portalOrigin(req)}/login`);
  }
  next();
});
amazonApp.use(express.static(publicDir, { maxAge: '1h', etag: true }));

// 生产端中间件
const productionDir = path.join(__dirname, 'public-production');
productionApp.use(cors);
productionApp.use(requestLog);
productionApp.use(compression());
productionApp.use(express.json({ limit: '20mb' }));
productionApp.use(express.urlencoded({ extended: true }));
productionApp.use((req, res, next) => { req.channel = 'production'; next(); });
productionApp.use(express.static(productionDir, { maxAge: '1h', etag: true }));

app.get(['/', '/login', '/login.html'], (req, res) => {
  sendHtmlPage(res, path.join(publicDir, 'login.html'), {
    app: 'login',
    channel: null,
    basePath: '/',
    assetBasePath: '/login-static'
  }, req);
});

app.get(['/ops/shopify', '/ops/shopify/*'], (req, res, next) => {
  if (isAssetRequest(req)) return next();
  sendHtmlPage(res, path.join(publicDir, 'index.html'), {
    app: 'shopify',
    channel: 'shopify',
    basePath: CHANNEL_PATHS.shopify,
    assetBasePath: CHANNEL_PATHS.shopify
  }, req);
});

app.get(['/ops/amazon', '/ops/amazon/*'], (req, res, next) => {
  if (isAssetRequest(req)) return next();
  sendHtmlPage(res, path.join(publicDir, 'index.html'), {
    app: 'amazon',
    channel: 'amazon',
    basePath: CHANNEL_PATHS.amazon,
    assetBasePath: CHANNEL_PATHS.amazon
  }, req);
});

app.get(['/admin', '/admin/*'], (req, res, next) => {
  if (isAssetRequest(req)) return next();
  sendHtmlPage(res, path.join(factoryDir, 'index.html'), {
    app: 'management',
    channel: null,
    basePath: CHANNEL_PATHS.management,
    assetBasePath: CHANNEL_PATHS.management,
    apiBase: `http://${HOST}:${FACTORY_PORT}`
  }, req);
});

app.get(['/production', '/production/*'], (req, res, next) => {
  if (isAssetRequest(req)) return next();
  const productionDir = path.join(__dirname, 'public-production');
  sendHtmlPage(res, path.join(productionDir, 'index.html'), {
    app: 'production',
    channel: 'production',
    basePath: CHANNEL_PATHS.production,
    assetBasePath: CHANNEL_PATHS.production
  }, req);
});

// ========== 统一门户 API（8080） ==========
app.use('/api/auth', unifiedAuthRoutes());
app.use('/api', resolvePortalAppContext, jwtAuth());
app.use('/api', healthRoutes);
app.use('/api', globalsRoutes);
app.use('/api', materialsRoutes);
app.use('/api', productsRoutes);
app.use('/api', rulesRoutes);
app.use('/api', calcRoutes);
app.use('/api', ordersRoutes);
app.use('/api', importExportRoutes);
app.use('/api', factoryRoutes);
app.use('/api', analyticsRoutes);
app.use('/api', backupsRoutes);
app.use('/api', shopifyRoutes);
app.use('/api', sampleRoutes());
app.use('/api', productionPhotosRoutes);
app.get('/api/bootstrap', (req, res) => {
  res.json({ ...context(req.channel), features: appConfig, rates: appConfig.rateConfig() });
});

// ========== 管理端路由 ==========
factoryApp.use('/api/auth', managementAuthRoutes());
factoryApp.use('/api', jwtAuth('management'));
factoryApp.use('/api', healthRoutes);
factoryApp.use('/api', userRoutes());
factoryApp.use('/api', globalsRoutes);
factoryApp.use('/api', materialsRoutes);
factoryApp.use('/api', rulesRoutes);
factoryApp.use('/api', calcRoutes);
factoryApp.use('/api', ordersRoutes);
factoryApp.use('/api', importExportRoutes);
factoryApp.use('/api', factoryRoutes);
factoryApp.use('/api', analyticsRoutes);
factoryApp.use('/api', backupsRoutes);
factoryApp.use('/api', sampleRoutes());
factoryApp.use('/api', productionPhotosRoutes);
factoryApp.get('/api/bootstrap', (req, res) => {
  res.json({ ...context(req.channel), features: appConfig, rates: appConfig.rateConfig() });
});

factoryApp.get(['/production', '/production/*'], (req, res, next) => {
  if (isAssetRequest(req)) return next();
  const productionDir = path.join(__dirname, 'public-production');
  sendHtmlPage(res, path.join(productionDir, 'index.html'), {
    app: 'production',
    channel: 'production',
    basePath: CHANNEL_PATHS.production,
    assetBasePath: CHANNEL_PATHS.production
  }, req);
});

// ========== 亚马逊端路由 ==========
amazonApp.use('/api/auth', authRoutes('amazon'));
amazonApp.use('/api', jwtAuth('amazon'));
amazonApp.use('/api', healthRoutes);
amazonApp.use('/api', globalsRoutes);
amazonApp.use('/api', materialsRoutes);
amazonApp.use('/api', productsRoutes);
amazonApp.use('/api', rulesRoutes);
amazonApp.use('/api', calcRoutes);
amazonApp.use('/api', ordersRoutes);
amazonApp.use('/api', importExportRoutes);
amazonApp.use('/api', factoryRoutes);
amazonApp.use('/api', analyticsRoutes);
amazonApp.use('/api', backupsRoutes);
amazonApp.use('/api', sampleRoutes());
amazonApp.use('/api', productionPhotosRoutes);
amazonApp.get('/api/bootstrap', (req, res) => {
  res.json({ ...context(req.channel), features: appConfig, rates: appConfig.rateConfig() });
});

// ========== 生产端路由 ==========
productionApp.use('/api/auth', managementAuthRoutes);
productionApp.use('/api', jwtAuth('management'));
productionApp.use('/api', ordersRoutes);
productionApp.use('/api', productionPhotosRoutes);
productionApp.get('/api/bootstrap', (req, res) => {
  res.json({ ...context('management'), features: appConfig, rates: appConfig.rateConfig() });
});

// 错误处理
app.use(errorHandler);
factoryApp.use(errorHandler);
amazonApp.use(errorHandler);
productionApp.use(errorHandler);

// 启动服务器
if (process.env.NO_AUTO_LISTEN !== '1') {
  const startAuxiliaryServers = shouldStartAuxiliaryServers();

  app.listen(PORT, HOST, () => {
    console.log(`TWODRAPES 独立站端已启动: http://${HOST}:${PORT}`);
    console.log(`独立站端本地访问 http://localhost:${PORT}`);
    if (!startAuxiliaryServers) {
      console.log('生产模式已启用单端口部署：管理端与亚马逊端通过路径入口提供，不再单独监听兼容端口。');
    }
  });

  if (startAuxiliaryServers) {
    factoryApp.listen(FACTORY_PORT, HOST, () => {
      console.log(`TWODRAPES 管理端已启动: http://${HOST}:${FACTORY_PORT}`);
      console.log(`管理端本地访问 http://localhost:${FACTORY_PORT}`);
    });

    amazonApp.listen(AMAZON_PORT, HOST, () => {
      console.log(`TWODRAPES 亚马逊端已启动: http://${HOST}:${AMAZON_PORT}`);
      console.log(`亚马逊端本地访问 http://localhost:${AMAZON_PORT}`);
    });

    productionApp.listen(PRODUCTION_PORT, HOST, () => {
      console.log(`TWODRAPES 生产端已启动: http://${HOST}:${PRODUCTION_PORT}`);
      console.log(`生产端本地访问 http://localhost:${PRODUCTION_PORT}`);
    });
  }
}

module.exports = { app, factoryApp, amazonApp, productionApp, shouldStartAuxiliaryServers };
