const DEFAULTS = {
  port: 8080,
  factoryPort: 8081,
  amazonPort: 8082,
  host: '0.0.0.0',
  adminUser: 'admin',
  adminPassword: 'twodrapes2025',
  paypalFeeRate: 0.044,
  usdRmbRate: 6.9
};

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function serverConfig() {
  return {
    port: numberEnv('PORT', DEFAULTS.port),
    factoryPort: numberEnv('FACTORY_PORT', DEFAULTS.factoryPort),
    amazonPort: numberEnv('AMAZON_PORT', DEFAULTS.amazonPort),
    host: process.env.HOST || DEFAULTS.host
  };
}

function rateConfig() {
  return {
    paypalFeeRate: numberEnv('PAYPAL_FEE_RATE', DEFAULTS.paypalFeeRate),
    usdRmbRate: numberEnv('USD_RMB_RATE', DEFAULTS.usdRmbRate)
  };
}

function authDisabled() {
  return process.env.NO_AUTH !== '0' && process.env.NO_AUTH !== 'false';
}

// Feature switches for unfinished or temporarily hidden modules.
//
// Shopify integration is intentionally disabled for now because the store
// does not have real orders yet. When it is needed later:
// 1. Change shopifyIntegrationEnabled to true.
// 2. Restart the server.
// 3. Configure Shopify domain and Admin API token in the UI.
// Auth is disabled by default for local use; set NO_AUTH=0 to require login.
function authConfig() {
  return {
    noAuth: authDisabled(),
    adminUser: process.env.ADMIN_USER || DEFAULTS.adminUser,
    adminPassword: process.env.ADMIN_PASSWORD || DEFAULTS.adminPassword,
    jwtSecret: process.env.JWT_SECRET || null,
    jwtExpiresIn: numberEnv('JWT_EXPIRES_IN', 86400)
  };
}

module.exports = {
  shopifyIntegrationEnabled: false,
  DEFAULTS,
  serverConfig,
  authConfig,
  rateConfig
};
