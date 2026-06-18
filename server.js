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
const { authRoutes, managementAuthRoutes, userRoutes } = require('./src/routes/auth');
const { jwtAuth } = require('./src/utils/auth');

const serverCfg = appConfig.serverConfig();
const { port: PORT, factoryPort: FACTORY_PORT, amazonPort: AMAZON_PORT } = serverCfg;
const HOST = serverCfg.host;

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

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

// 初始化数据库
for (const dir of [dataDir, backupDir, exportDir]) fs.mkdirSync(dir, { recursive: true });
initDb();
seedIfEmpty();

// 运营端（独立站）中间件
app.use(cors);
app.use(requestLog);
app.use(compression());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => { req.channel = 'shopify'; next(); });
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

// 管理端中间件
factoryApp.use(cors);
factoryApp.use(requestLog);
factoryApp.use(compression());
factoryApp.use(express.json({ limit: '20mb' }));
factoryApp.use(express.urlencoded({ extended: true }));
factoryApp.use(express.static(path.join(__dirname, 'public-factory'), { maxAge: '1h', etag: true }));

// 亚马逊端中间件（共用 public/ 前端）
amazonApp.use(cors);
amazonApp.use(requestLog);
amazonApp.use(compression());
amazonApp.use(express.json({ limit: '20mb' }));
amazonApp.use(express.urlencoded({ extended: true }));
amazonApp.use((req, res, next) => { req.channel = 'amazon'; next(); });
amazonApp.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

// ========== 运营端路由（独立站） ==========
app.use('/api/auth', authRoutes('shopify'));
app.use('/api', jwtAuth('shopify'));
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
app.get('/api/bootstrap', (req, res) => {
  res.json({ ...context(req.channel), features: appConfig, rates: appConfig.rateConfig() });
});

// ========== 管理端路由 ==========
factoryApp.use('/api/auth', managementAuthRoutes());
factoryApp.use('/api', jwtAuth(null));
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
factoryApp.get('/api/bootstrap', (req, res) => {
  res.json({ ...context(req.channel), features: appConfig, rates: appConfig.rateConfig() });
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
amazonApp.get('/api/bootstrap', (req, res) => {
  res.json({ ...context(req.channel), features: appConfig, rates: appConfig.rateConfig() });
});

// 错误处理
app.use(errorHandler);
factoryApp.use(errorHandler);
amazonApp.use(errorHandler);

// 启动服务器
if (process.env.NO_AUTO_LISTEN !== '1') {
  app.listen(PORT, HOST, () => {
    console.log(`TWODRAPES 独立站端已启动: http://${HOST}:${PORT}`);
    console.log(`独立站端本地访问 http://localhost:${PORT}`);
  });

  factoryApp.listen(FACTORY_PORT, HOST, () => {
    console.log(`TWODRAPES 管理端已启动: http://${HOST}:${FACTORY_PORT}`);
    console.log(`管理端本地访问 http://localhost:${FACTORY_PORT}`);
  });

  amazonApp.listen(AMAZON_PORT, HOST, () => {
    console.log(`TWODRAPES 亚马逊端已启动: http://${HOST}:${AMAZON_PORT}`);
    console.log(`亚马逊端本地访问 http://localhost:${AMAZON_PORT}`);
  });
}

module.exports = { app, factoryApp, amazonApp };
